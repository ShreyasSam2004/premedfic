"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChartColumn, ClipboardCheck, Files, FolderKanban, Landmark, LayoutDashboard, LogOut, Menu, Scale, Search, Send, Settings, X } from "lucide-react";
import { BrandMark } from "./brand";
import { cn, Kbd } from "@/components/ui/primitives";
import { logoutAction } from "@/app/(staff)/actions";

const NAV = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/permits", label: "Permits", icon: Files },
  { href: "/cases", label: "Cases", icon: FolderKanban },
  { href: "/review", label: "Evidence Review", icon: ClipboardCheck, count: "review" as const },
  { href: "/outreach", label: "Outreach", icon: Send, count: "outreach" as const },
  { href: "/analytics", label: "Analytics", icon: ChartColumn },
  { href: "/austin", label: "Austin analysis", icon: Landmark },
  { href: "/rules", label: "Jurisdiction Rules", icon: Scale },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ orgName, user, counts, demo }: { orgName: string; user: { name: string; role: string }; counts: { review: number; outreach: number }; demo: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const nav = (
    <nav aria-label="Primary" className="flex flex-col gap-0.5 px-2">
      {NAV.map((item) => {
        const active = path === item.href || path.startsWith(`${item.href}/`);
        const n = item.count ? counts[item.count] : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
              active ? "bg-surface text-ink shadow-[var(--shadow-card)] ring-1 ring-line" : "text-ink-2 hover:bg-subtle hover:text-ink",
            )}
          >
            <item.icon className={cn("size-4", active ? "text-brand" : "text-muted group-hover:text-ink-2")} aria-hidden />
            <span className="flex-1">{item.label}</span>
            {n > 0 && <span className="tabular rounded-full bg-subtle px-1.5 text-[11px] font-semibold text-ink-2 ring-1 ring-line">{n}</span>}
          </Link>
        );
      })}
    </nav>
  );
  const body = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <BrandMark size={26} />
        <div className="min-w-0">
          <div className="text-[13.5px] leading-tight font-semibold">PremedFix</div>
          <div className="truncate text-[11.5px] leading-tight text-muted" title={orgName}>
            {orgName}
          </div>
        </div>
      </div>
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("pf:open-search"))}
          className="flex h-8 w-full items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-[12.5px] text-muted hover:border-line-strong"
        >
          <Search className="size-3.5" aria-hidden />
          <span className="flex-1 text-left">Find permit or address</span>
          <Kbd>Ctrl K</Kbd>
        </button>
      </div>
      {nav}
      <div className="mt-auto space-y-3 px-3 pt-6 pb-4">
        {demo && <div className="rounded-md border border-dashed border-line-strong px-2.5 py-2 text-[11px] leading-snug text-muted">Demo environment. Case data is fictional; the Austin analysis uses real public data. Messages are simulated and never sent.</div>}
        <div className="flex items-center gap-2 rounded-md px-1">
          <div className="flex size-7 items-center justify-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand">
            {user.name
              .split(" ")
              .map((p) => p[0])
              .join("")
              .slice(0, 2)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-medium">{user.name}</div>
            <div className="truncate text-[11px] text-muted">{user.role}</div>
          </div>
          <form action={logoutAction}>
            <button type="submit" title="Sign out" aria-label="Sign out" className="rounded p-1.5 text-muted hover:bg-subtle hover:text-ink">
              <LogOut className="size-3.5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-[236px] shrink-0 border-r border-line bg-[#fafbfc] lg:block">{body}</aside>
      <div className="fixed top-3 left-3 z-30 lg:hidden">
        <button type="button" onClick={() => setOpen(true)} aria-label="Open navigation" className="rounded-md border border-line bg-surface p-2 shadow-[var(--shadow-card)]">
          <Menu className="size-4" />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[260px] border-r border-line bg-[#fafbfc] shadow-[var(--shadow-pop)]">
            <button type="button" onClick={() => setOpen(false)} aria-label="Close navigation" className="absolute top-3 right-3 rounded p-1.5 text-muted hover:bg-subtle">
              <X className="size-4" />
            </button>
            {body}
          </aside>
        </div>
      )}
    </>
  );
}
