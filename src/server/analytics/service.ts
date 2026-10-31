/**
 * Operational metrics, computed from live records on every request.
 * Measured metrics and estimates are returned in separate structures so the
 * UI can never present an estimate as a measurement.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { AWAITING_OWNER_STATES, CASE_STATES, REVIEW_QUEUE_STATES, UNRESOLVED_STATES, type CaseState } from "@/domain/workflow";
import { db } from "../db/client";
import { cases, evidenceSubmissions, organizations, permits, properties, reviewDecisions, triageResults, users, workflowTransitions } from "../db/schema";
import { isoDate, now } from "../util";
import { caseFilterConditions, type CaseFilters } from "../cases/queries";

type Row = Record<string, unknown>;
const rows = (r: unknown) => (r as { rows: Row[] }).rows;

export async function statusCounts(orgId: string, f: CaseFilters = {}, userId?: string) {
  const res = await db()
    .select({ status: cases.status, n: sql<number>`count(*)::int`, monitor: sql<number>`count(*) filter (where ${cases.classification} = 'MONITOR_ACTIVE')::int` })
    .from(cases)
    .innerJoin(permits, eq(permits.id, cases.permitId))
    .leftJoin(properties, eq(properties.id, permits.propertyId))
    .where(caseFilterConditions(orgId, f, userId))
    .groupBy(cases.status);
  const counts = Object.fromEntries(CASE_STATES.map((s) => [s, 0])) as Record<CaseState, number>;
  let monitorOpen = 0;
  for (const r of res) {
    counts[r.status] = r.n;
    if (r.status === "TRIAGED") monitorOpen += r.monitor;
  }
  return { counts, monitorOpen };
}

export async function getOverview(orgId: string, f: CaseFilters = {}, userId?: string) {
  const { counts, monitorOpen } = await statusCounts(orgId, f, userId);
  const sum = (states: CaseState[]) => states.reduce((a, s) => a + counts[s], 0);
  const where = caseFilterConditions(orgId, f, userId);
  const today = isoDate(now());
  const [agg] = await db()
    .select({
      expiredOpen: sql<number>`count(*) filter (where ${cases.closedAt} is null and ${cases.status} not in ('MERGED_DUPLICATE','FINALIZATION_VERIFICATION') and (${permits.expiresAt} < ${today} or ${permits.sourceStatus} = 'expired'))::int`,
      resolved30: sql<number>`count(*) filter (where ${cases.status} in ('OFFICIALLY_CLOSED','OTHER_OFFICIAL_OUTCOME') and ${cases.closedAt} > now() - interval '30 days')::int`,
      avgDays: sql<number | null>`avg(extract(epoch from (${cases.closedAt} - ${cases.openedAt})) / 86400) filter (where ${cases.status} in ('OFFICIALLY_CLOSED','OTHER_OFFICIAL_OUTCOME'))`,
      resolvedN: sql<number>`count(*) filter (where ${cases.status} in ('OFFICIALLY_CLOSED','OTHER_OFFICIAL_OUTCOME'))::int`,
      specialist: sql<number>`count(*) filter (where ${cases.classification} = 'SPECIALIST_REVIEW' and ${cases.closedAt} is null)::int`,
      p1: sql<number>`count(*) filter (where ${cases.priority} = 'P1' and ${cases.closedAt} is null and ${cases.status} <> 'FINALIZATION_VERIFICATION')::int`,
    })
    .from(cases)
    .innerJoin(permits, eq(permits.id, cases.permitId))
    .leftJoin(properties, eq(properties.id, permits.propertyId))
    .where(where);
  // The active backlog excludes reported finals awaiting verification and
  // permits already finalized before PremedFix; each has its own count.
  const unresolvedTotal = sum(UNRESOLVED_STATES);
  return {
    counts,
    tiles: {
      unresolved: unresolvedTotal - monitorOpen,
      finalizationToVerify: counts.FINALIZATION_VERIFICATION,
      alreadyResolved: counts.ALREADY_RESOLVED,
      expired: agg.expiredOpen,
      needsAttention: counts.NEEDS_DATA_RECONCILIATION + (counts.TRIAGED - monitorOpen) + counts.AWAITING_CONTACT_APPROVAL,
      awaitingHomeowner: sum(AWAITING_OWNER_STATES),
      evidenceAwaitingReview: counts.EVIDENCE_RECEIVED + counts.UNDER_STAFF_REVIEW,
      inspectionRequired: counts.INSPECTION_REQUIRED,
      readyForDisposition: counts.READY_FOR_AUTHORIZED_DISPOSITION,
      pendingConfirmation: counts.DISPOSITION_PENDING_CONFIRMATION,
      confirmedResolutions: counts.OFFICIALLY_CLOSED + counts.OTHER_OFFICIAL_OUTCOME,
      resolvedLast30: agg.resolved30,
      avgProcessingDays: agg.avgDays === null ? null : Number(agg.avgDays),
      resolvedSample: agg.resolvedN,
      specialistOpen: agg.specialist,
      p1Open: agg.p1,
      monitorOpen,
    },
  };
}

export async function backlogSeries(orgId: string, opts: { months?: number; jurisdictionId?: string; category?: string } = {}) {
  const months = opts.months ?? 18;
  const asOf = isoDate(now());
  const j = opts.jurisdictionId ? sql`and p.jurisdiction_id = ${opts.jurisdictionId}` : sql``;
  const cat = opts.category ? sql`and p.category = ${opts.category}` : sql``;
  const res = await db().execute(sql`
    with months as (
      select (date_trunc('month', ${asOf}::date) - make_interval(months => n) + interval '1 month - 1 day')::date as month_end
      from generate_series(0, ${months - 1}::int) as n
    )
    select to_char(m.month_end, 'YYYY-MM-DD') as month_end,
      (select count(*)::int from permits p join cases c on c.permit_id = p.id
        where p.org_id = ${orgId} ${j} ${cat}
          and c.status not in ('MERGED_DUPLICATE','FINALIZATION_VERIFICATION','ALREADY_RESOLVED')
          and p.expires_at is not null and p.expires_at <= m.month_end
          and (c.closed_at is null or c.closed_at::date > m.month_end)) as backlog,
      (select count(*)::int from cases c join permits p on p.id = c.permit_id
        where c.org_id = ${orgId} ${j} ${cat}
          and c.status in ('OFFICIALLY_CLOSED','OTHER_OFFICIAL_OUTCOME')
          and c.closed_at::date <= m.month_end
          and c.closed_at::date > (m.month_end - interval '1 month')::date) as resolved
    from months m
    order by m.month_end`);
  return rows(res).map((r) => ({ monthEnd: String(r.month_end), backlog: Number(r.backlog), resolved: Number(r.resolved) }));
}

export async function getAnalytics(orgId: string) {
  const { counts } = await statusCounts(orgId);

  const timeInState = rows(
    await db().execute(sql`
      select to_state, count(*)::int as n, avg(extract(epoch from (next_at - created_at))) / 3600.0 as avg_hours
      from (
        select to_state, created_at, lead(created_at) over (partition by case_id order by created_at) as next_at
        from workflow_transitions where org_id = ${orgId}
      ) t
      where next_at is not null
      group by to_state`),
  ).map((r) => ({ state: String(r.to_state) as CaseState, n: Number(r.n), avgHours: Number(r.avg_hours) }));
  const [overallNext] = rows(
    await db().execute(sql`
      select count(*)::int as n, avg(extract(epoch from (next_at - created_at))) / 3600.0 as avg_hours
      from (
        select created_at, actor_type, lead(created_at) over (partition by case_id order by created_at) as next_at,
               lead(actor_type) over (partition by case_id order by created_at) as next_actor
        from workflow_transitions where org_id = ${orgId}
      ) t
      where next_at is not null and next_actor = 'user'`),
  );

  const [resolution] = rows(
    await db().execute(sql`
      select count(*)::int as n,
        percentile_cont(0.5) within group (order by extract(epoch from (closed_at - opened_at)) / 86400.0) as median_days
      from cases where org_id = ${orgId} and status = 'OFFICIALLY_CLOSED'`),
  );

  const awaitingAging = rows(
    await db().execute(sql`
      select case
          when now() - last_transition_at < interval '14 days' then 'Under 14 days'
          when now() - last_transition_at < interval '30 days' then '14–30 days'
          else 'Over 30 days' end as bucket,
        count(*)::int as n
      from cases where org_id = ${orgId} and status in ('OWNER_CONTACTED','AWAITING_EVIDENCE','ADDITIONAL_INFORMATION_REQUIRED')
      group by 1`),
  ).map((r) => ({ bucket: String(r.bucket), n: Number(r.n) }));

  const workload = await db()
    .select({ userId: users.id, name: users.name, n: sql<number>`count(*)::int` })
    .from(cases)
    .innerJoin(users, sql`${users.id} = coalesce(${cases.specialistUserId}, ${cases.assignedUserId})`)
    .where(and(eq(cases.orgId, orgId), inArray(cases.status, REVIEW_QUEUE_STATES)))
    .groupBy(users.id, users.name)
    .orderBy(sql`count(*) desc`);
  const [{ unassignedReview }] = await db()
    .select({ unassignedReview: sql<number>`count(*)::int` })
    .from(cases)
    .where(and(eq(cases.orgId, orgId), inArray(cases.status, REVIEW_QUEUE_STATES), sql`coalesce(${cases.specialistUserId}, ${cases.assignedUserId}) is null`));

  const [{ submittedCases }] = await db()
    .select({ submittedCases: sql<number>`count(distinct ${evidenceSubmissions.caseId})::int` })
    .from(evidenceSubmissions)
    .where(and(eq(evidenceSubmissions.orgId, orgId), eq(evidenceSubmissions.status, "submitted")));
  const [{ requestedCases }] = await db()
    .select({ requestedCases: sql<number>`count(distinct ${reviewDecisions.caseId})::int` })
    .from(reviewDecisions)
    .where(and(eq(reviewDecisions.orgId, orgId), inArray(reviewDecisions.decisionType, ["request_information", "request_corrected_documents"])));
  const [{ reopened }] = await db()
    .select({ reopened: sql<number>`count(distinct ${workflowTransitions.caseId})::int` })
    .from(workflowTransitions)
    .where(and(eq(workflowTransitions.orgId, orgId), eq(workflowTransitions.transition, "reopen_case")));
  const [{ everResolved }] = await db()
    .select({ everResolved: sql<number>`count(distinct ${workflowTransitions.caseId})::int` })
    .from(workflowTransitions)
    .where(and(eq(workflowTransitions.orgId, orgId), inArray(workflowTransitions.toState, ["OFFICIALLY_CLOSED", "OTHER_OFFICIAL_OUTCOME"])));
  const [{ reviewActions, overrides }] = await db()
    .select({
      reviewActions: sql<number>`count(*) filter (where ${reviewDecisions.decisionType} in ('request_information','request_corrected_documents','require_inspection','mark_ready','return_to_review'))::int`,
      overrides: sql<number>`count(*) filter (where ${reviewDecisions.overrodeSuggestion})::int`,
    })
    .from(reviewDecisions)
    .where(eq(reviewDecisions.orgId, orgId));
  const [{ triageRuns, triagedCases }] = await db()
    .select({ triageRuns: sql<number>`count(*)::int`, triagedCases: sql<number>`count(distinct ${triageResults.caseId})::int` })
    .from(triageResults)
    .where(eq(triageResults.orgId, orgId));
  const [org] = await db().select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, orgId));
  const minutes = org.settings.manualResearchMinutesPerCase;

  return {
    counts,
    measured: {
      avgHoursToNextHumanAction: overallNext?.n ? Number(overallNext.avg_hours) : null,
      nextActionSample: Number(overallNext?.n ?? 0),
      timeInState,
      medianDaysToVerifiedResolution: resolution?.n ? Number(resolution.median_days) : null,
      resolutionSample: Number(resolution?.n ?? 0),
      awaitingAging,
      workload,
      unassignedReview,
      evidenceRequestRate: submittedCases ? requestedCases / submittedCases : null,
      evidenceRequestSample: submittedCases,
      reopenRate: everResolved ? reopened / everResolved : null,
      reopenSample: everResolved,
      overrideRate: reviewActions ? overrides / reviewActions : null,
      overrideSample: reviewActions,
      triageRuns,
      triagedCases,
    },
    estimates: {
      researchHoursAvoided: (triagedCases * minutes) / 60,
      assumptionMinutesPerCase: minutes,
      basis: `${triagedCases} cases triaged automatically × ${minutes} minutes of manual record research per case (an assumption set in Settings, not a measurement).`,
    },
  };
}
