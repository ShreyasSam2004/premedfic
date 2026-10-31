import { Lock } from "lucide-react";
import { Card, EmptyState, LinkButton } from "@/components/ui/primitives";

export function AccessDenied({ what }: { what: string }) {
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <EmptyState
        icon={<Lock className="size-6" />}
        title="Not available for your role"
        description={`Your role does not include permission to ${what}. Ask a municipal administrator if you need access.`}
        action={<LinkButton href="/overview">Back to overview</LinkButton>}
      />
    </Card>
  );
}
