/**
 * Design-system primitives. Server-component safe (no client hooks).
 */
import Link from "next/link";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ComponentProps, ReactNode } from "react";
import type { Tone } from "@/domain/workflow";

export function cn(...args: Parameters<typeof clsx>) {
  return twMerge(clsx(...args));
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-hover shadow-[0_1px_0_rgba(255,255,255,0.12)_inset] disabled:bg-faint",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-subtle disabled:text-faint",
  ghost: "text-ink-2 hover:bg-subtle disabled:text-faint",
  danger: "bg-surface text-tone-critical-fg border border-[#fecdca] hover:bg-tone-critical-bg disabled:text-faint",
  subtle: "bg-subtle text-ink-2 hover:bg-line disabled:text-faint",
};
const SIZES: Record<Size, string> = { sm: "h-7 px-2.5 text-[12.5px] gap-1.5", md: "h-8.5 px-3.5 text-[13px] gap-2" };

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra?: string) {
  return cn(
    "inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed select-none",
    VARIANTS[variant],
    SIZES[size],
    extra,
  );
}

export function Button({ variant = "secondary", size = "md", className, ...rest }: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...rest} />;
}

export function LinkButton({ variant = "secondary", size = "md", className, ...rest }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

const TONES: Record<Tone, string> = {
  neutral: "bg-tone-neutral-bg text-tone-neutral-fg",
  info: "bg-tone-info-bg text-tone-info-fg",
  attention: "bg-tone-attention-bg text-tone-attention-fg",
  critical: "bg-tone-critical-bg text-tone-critical-fg",
  review: "bg-tone-review-bg text-tone-review-fg",
  pending: "bg-tone-pending-bg text-tone-pending-fg",
  confirmed: "bg-tone-confirmed-bg text-tone-confirmed-fg",
};
const DOTS: Record<Tone, string> = {
  neutral: "bg-tone-neutral-dot",
  info: "bg-tone-info-dot",
  attention: "bg-tone-attention-dot",
  critical: "bg-tone-critical-dot",
  review: "bg-tone-review-dot",
  pending: "bg-tone-pending-dot",
  confirmed: "bg-tone-confirmed-dot",
};

export function Badge({ tone = "neutral", dot = true, children, title, className }: { tone?: Tone; dot?: boolean; children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-4 whitespace-nowrap", TONES[tone], className)}>
      {dot && <span aria-hidden className={cn("size-1.5 rounded-full", DOTS[tone])} />}
      {children}
    </span>
  );
}

export function Tag({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center rounded border border-line bg-surface px-1.5 py-px text-[11px] font-medium text-ink-2 whitespace-nowrap", className)}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Card({ children, className, ...rest }: ComponentProps<"section">) {
  return (
    <section className={cn("rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]", className)} {...rest}>
      {children}
    </section>
  );
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn("flex items-start justify-between gap-3 border-b border-line px-4 py-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[13.5px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[12.5px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-4 py-3.5", className)}>{children}</div>;
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[12px] font-medium text-muted">{eyebrow}</div>}
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn("mb-2 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase", className)}>{children}</h3>;
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      {icon && <div className="mb-3 text-faint">{icon}</div>}
      <p className="text-[13.5px] font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[12.5px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Callout({ tone = "info", title, children, icon, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; icon?: ReactNode; className?: string }) {
  const border: Record<Tone, string> = {
    neutral: "border-line",
    info: "border-[#c7d7fe]",
    attention: "border-[#fedf89]",
    critical: "border-[#fecdca]",
    review: "border-[#d9d6fe]",
    pending: "border-[#a5f0fc]",
    confirmed: "border-[#abefc6]",
  };
  return (
    <div className={cn("flex gap-2.5 rounded-lg border px-3 py-2.5 text-[12.5px]", TONES[tone], border[tone], className)}>
      {icon && <div className="mt-px shrink-0">{icon}</div>}
      <div className="min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(title && "mt-0.5", "opacity-95")}>{children}</div>}
      </div>
    </div>
  );
}

export function DL({ items, className, cols = 1, stacked = false }: { items: [ReactNode, ReactNode][]; className?: string; cols?: 1 | 2; stacked?: boolean }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-2.5", cols === 2 && "sm:grid-cols-2", className)}>
      {items.map(([k, v], i) => (
        <div key={i} className={cn("text-[12.5px]", stacked ? "grid gap-0.5" : "grid grid-cols-[132px_1fr] gap-3")}>
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v ?? <span className="text-faint">Not recorded</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-surface px-1 font-mono text-[10.5px] text-muted shadow-[0_1px_0_var(--color-line)]">{children}</kbd>;
}

// ---------------------------------------------------------------------------
// Forms (uncontrolled; work with server actions)
// ---------------------------------------------------------------------------

export const inputClass =
  "h-8.5 w-full rounded-md border border-line-strong bg-surface px-2.5 text-[13px] text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:bg-subtle";

export function Label({ children, htmlFor, hint }: { children: ReactNode; htmlFor?: string; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-[12.5px] font-medium text-ink-2">
      {children}
      {hint && <span className="ml-1.5 font-normal text-muted">{hint}</span>}
    </label>
  );
}

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cn(inputClass, props.className)} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea {...props} className={cn(inputClass, "h-auto min-h-20 py-2 leading-snug", props.className)} />;
}

export function Select(props: ComponentProps<"select">) {
  return (
    <select
      {...props}
      className={cn(
        inputClass,
        "appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23667085%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:12px] bg-[right_8px_center] bg-no-repeat pr-7",
        props.className,
      )}
    />
  );
}

export function Field({ label, htmlFor, hint, children, className }: { label: ReactNode; htmlFor?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} hint={hint}>
        {label}
      </Label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-left text-[12.5px]">{children}</table>
    </div>
  );
}
export function Th({ children, className, ...rest }: ComponentProps<"th">) {
  return (
    <th className={cn("sticky top-0 z-[1] border-b border-line bg-subtle/70 px-3 py-2 text-[11.5px] font-medium whitespace-nowrap text-muted backdrop-blur", className)} {...rest}>
      {children}
    </th>
  );
}
export function Td({ children, className, ...rest }: ComponentProps<"td">) {
  return (
    <td className={cn("border-b border-line px-3 py-2 align-middle", className)} {...rest}>
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function fmtDate(d: Date | string | null | undefined, opts: { time?: boolean } = {}) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d) : d;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(opts.time ? { hour: "numeric", minute: "2-digit" } : {}),
    timeZone: "UTC",
  });
}

export function relTime(d: Date | null | undefined) {
  if (!d) return "—";
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 45) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(d);
}

export function ageLabel(fromIso: string | null) {
  if (!fromIso) return "—";
  const days = Math.floor((Date.now() - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
  if (days < 0) return "future";
  if (days < 365) return `${days}d`;
  return `${(days / 365.25).toFixed(1)}y`;
}
