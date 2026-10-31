import { redirect } from "next/navigation";
import { getStaffSession } from "@/server/auth/session";
import { LoginForm } from "./login-form";
import { BrandMark } from "@/components/app/brand";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getStaffSession()) redirect("/overview");
  const { next } = await searchParams;
  const demo = process.env.DEMO_MODE === "true";
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex items-center gap-2.5">
          <BrandMark />
          <div>
            <div className="text-[15px] font-semibold tracking-[-0.01em]">PremedFix</div>
            <div className="text-[12px] text-muted">Permit Resolution Operating System</div>
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-6 shadow-[var(--shadow-card)]">
          <h1 className="text-[16px] font-semibold">Staff sign in</h1>
          <p className="mt-1 text-[12.5px] text-muted">Municipal staff accounts only. Property owners use the secure link in their notice.</p>
          <LoginForm next={next ?? ""} />
        </div>
        {demo && (
          <div className="mt-4 rounded-lg border border-dashed border-line-strong bg-surface/60 p-3.5 text-[12px] text-muted">
            <div className="mb-1.5 font-medium text-ink-2">Demo environment — fictional data</div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11.5px]">
              <span>admin@lakemont.example</span>
              <span className="text-faint">Administrator</span>
              <span>clerk@lakemont.example</span>
              <span className="text-faint">Permit clerk</span>
              <span>inspector@lakemont.example</span>
              <span className="text-faint">Inspector (electrical)</span>
              <span>official@lakemont.example</span>
              <span className="text-faint">Building official</span>
              <span>manager@lakemont.example</span>
              <span className="text-faint">Dept. manager</span>
            </div>
            <div className="mt-1.5">
              Password: <span className="font-mono text-ink-2">premedfix-demo</span>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
