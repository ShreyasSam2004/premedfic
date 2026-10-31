import { initDatabase } from "@/server/db/client";
import { getGrantForToken } from "@/server/portal/service";
import { VerifyFlow } from "./verify-flow";

export const metadata = { title: "Verify" };

export default async function PortalEntry({ params }: { params: Promise<{ token: string }> }) {
  await initDatabase();
  const { token } = await params;
  const info = await getGrantForToken(token);
  if (!info) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6">
        <h1 className="text-[19px] font-semibold">This link is no longer valid</h1>
        <p className="mt-2 text-ink-2">The link may have expired or been replaced by a newer one. Please contact the building department and they can send you a new link.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em]">{info.departmentName}</h1>
        <p className="mt-1 text-ink-2">You were sent this link about a building permit record for a property. To protect privacy, please confirm it&rsquo;s you before we show any details.</p>
      </div>
      <VerifyFlow token={token} channel={info.codeChannel} masked={info.maskedDestination} department={info.departmentName} phone={info.departmentPhone} demo={process.env.DEMO_MODE === "true"} />
    </div>
  );
}
