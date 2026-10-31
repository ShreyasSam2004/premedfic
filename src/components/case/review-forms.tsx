/** Inline reviewer controls for checklist items, documents, and findings. */
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { Input } from "@/components/ui/primitives";
import { evidenceItemAction, requirementAction, resolveFindingAction } from "@/app/(staff)/actions";

export function RequirementControls({ id, status }: { id: string; status: string }) {
  if (status === "accepted" || status === "waived") return null;
  return (
    <ActionForm action={requirementAction} className="mt-2 flex flex-wrap items-center gap-1.5" compact>
      <input type="hidden" name="requirementId" value={id} />
      <Input name="note" placeholder={status === "provided" ? "Note (optional to accept; required to reject/waive)" : "Reason to waive (required)"} className="h-7 min-w-[200px] flex-1 text-[12px]" aria-label="Reviewer note" />
      {status === "provided" && (
        <SubmitButton size="sm" variant="secondary" name="decision" value="accept">
          Accept
        </SubmitButton>
      )}
      {status === "provided" && (
        <SubmitButton size="sm" variant="ghost" name="decision" value="reject">
          Reject
        </SubmitButton>
      )}
      <SubmitButton size="sm" variant="ghost" name="decision" value="waive">
        Waive
      </SubmitButton>
    </ActionForm>
  );
}

export function ItemControls({ id, reviewStatus }: { id: string; reviewStatus: string }) {
  return (
    <ActionForm action={evidenceItemAction} className="flex flex-wrap items-center gap-1.5" compact>
      <input type="hidden" name="itemId" value={id} />
      <Input name="note" placeholder="Reviewer note (required to reject)" className="h-7 min-w-[220px] flex-1 text-[12px]" aria-label="Document note" />
      <SubmitButton size="sm" variant="secondary" name="decision" value="accept" disabled={reviewStatus === "accepted"}>
        Accept document
      </SubmitButton>
      <SubmitButton size="sm" variant="ghost" name="decision" value="reject" disabled={reviewStatus === "rejected"}>
        Reject
      </SubmitButton>
    </ActionForm>
  );
}

export function FindingControls({ id, kind, status }: { id: string; kind: string; status: string }) {
  if (status !== "open" || !["conflict", "warning", "untrusted_instruction"].includes(kind)) return null;
  return (
    <ActionForm action={resolveFindingAction} className="mt-2 flex flex-wrap items-center gap-1.5" compact>
      <input type="hidden" name="findingId" value={id} />
      <Input name="note" placeholder="How was this resolved? Both records are kept." className="h-7 min-w-[220px] flex-1 text-[12px]" aria-label="Resolution note" required />
      <SubmitButton size="sm" variant="secondary">
        Resolve
      </SubmitButton>
    </ActionForm>
  );
}
