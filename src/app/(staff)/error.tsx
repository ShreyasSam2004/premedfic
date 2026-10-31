"use client";

import { CircleAlert } from "lucide-react";
import { Button, Card, EmptyState } from "@/components/ui/primitives";

export default function StaffError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <EmptyState
        icon={<CircleAlert className="size-6" />}
        title="This page could not be loaded"
        description={`No changes were made. If this keeps happening, contact your administrator${error.digest ? ` and mention reference ${error.digest}` : ""}.`}
        action={<Button onClick={reset}>Try again</Button>}
      />
    </Card>
  );
}
