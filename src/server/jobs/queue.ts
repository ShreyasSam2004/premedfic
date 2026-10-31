/**
 * Database-backed job queue.
 *
 * - Enqueue is idempotent on `idempotencyKey` (unique), so double-submits
 *   never create duplicate work.
 * - Claiming is a single conditional UPDATE, so two workers cannot run the
 *   same job; stale `running` jobs (crashed worker) become reclaimable.
 * - Handlers must be idempotent; failed jobs retry up to `maxAttempts`.
 *
 * In the web process, jobs are run immediately after enqueue (inline) so the
 * user sees results; `npm run worker` drains anything left queued or failed.
 */
import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import { jobs, type Job } from "../db/schema";
import { log, now } from "../util";

type Handler = (payload: Record<string, unknown>) => Promise<Record<string, unknown> | void>;
const handlers = new Map<string, Handler>();

export function registerJobHandler(type: string, handler: Handler) {
  handlers.set(type, handler);
}

const STALE_MS = 10 * 60 * 1000;

export async function enqueueJob(input: {
  orgId: string | null;
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  maxAttempts?: number;
}): Promise<Job> {
  const [created] = await db()
    .insert(jobs)
    .values({
      orgId: input.orgId,
      type: input.type,
      payload: input.payload,
      status: "queued",
      idempotencyKey: input.idempotencyKey,
      maxAttempts: input.maxAttempts ?? 3,
      createdAt: now(),
    })
    .onConflictDoNothing({ target: jobs.idempotencyKey })
    .returning();
  if (created) return created;
  const [existing] = await db().select().from(jobs).where(eq(jobs.idempotencyKey, input.idempotencyKey));
  return existing;
}

export async function runJob(jobId: string): Promise<Job> {
  const staleBefore = new Date(Date.now() - STALE_MS);
  const [claimed] = await db()
    .update(jobs)
    .set({ status: "running", lockedAt: new Date(), attempts: sql`${jobs.attempts} + 1` })
    .where(
      and(
        eq(jobs.id, jobId),
        lt(jobs.attempts, jobs.maxAttempts),
        or(inArray(jobs.status, ["queued", "failed"]), and(eq(jobs.status, "running"), lt(jobs.lockedAt, staleBefore))),
      ),
    )
    .returning();
  if (!claimed) {
    const [current] = await db().select().from(jobs).where(eq(jobs.id, jobId));
    return current;
  }
  const handler = handlers.get(claimed.type);
  try {
    if (!handler) throw new Error(`No handler registered for job type ${claimed.type}`);
    const result = (await handler(claimed.payload)) ?? {};
    const [done] = await db()
      .update(jobs)
      .set({ status: "succeeded", result, completedAt: new Date(), lastError: null, lockedAt: null })
      .where(eq(jobs.id, claimed.id))
      .returning();
    return done;
  } catch (err) {
    log.error("job.failed", err, { jobId: claimed.id, type: claimed.type, attempt: claimed.attempts });
    const message = err instanceof Error ? err.message : String(err);
    const [failed] = await db()
      .update(jobs)
      .set({ status: "failed", lastError: message.slice(0, 500), lockedAt: null })
      .where(eq(jobs.id, claimed.id))
      .returning();
    return failed;
  }
}

/** Reset attempts for a job that exhausted retries, then run it. */
export async function retryJob(orgId: string, jobId: string): Promise<Job | null> {
  const [job] = await db()
    .update(jobs)
    .set({ attempts: 0, status: "queued" })
    .where(and(eq(jobs.id, jobId), eq(jobs.orgId, orgId), eq(jobs.status, "failed")))
    .returning();
  return job ? runJob(job.id) : null;
}

export async function runPendingJobs(limit = 25) {
  const pending = await db()
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(inArray(jobs.status, ["queued", "failed"]), lt(jobs.attempts, jobs.maxAttempts)))
    .orderBy(asc(jobs.createdAt))
    .limit(limit);
  const results: Job[] = [];
  for (const j of pending) results.push(await runJob(j.id));
  return results;
}

export async function listJobs(orgId: string, limit = 50) {
  return db().select().from(jobs).where(eq(jobs.orgId, orgId)).orderBy(desc(jobs.createdAt)).limit(limit);
}
