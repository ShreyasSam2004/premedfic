import { Lock } from "lucide-react";

export const metadata = { title: { default: "Permit information", template: "%s · Permit information" } };

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[640px] items-center gap-2 px-4 py-3 text-[13px]">
          <Lock className="size-3.5 text-muted" aria-hidden />
          <span className="font-medium">Secure permit portal</span>
          <span className="text-muted">· building department</span>
        </div>
      </header>
      <main className="mx-auto max-w-[640px] px-4 py-6 text-[15px]">{children}</main>
      <footer className="mx-auto max-w-[640px] px-4 pb-8 text-[12px] text-muted">
        This page shows information about one building permit. Submitting documents does not close a permit; staff review everything you provide.
      </footer>
    </div>
  );
}
