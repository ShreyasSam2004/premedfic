"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Search } from "lucide-react";
import { STATE_META, type CaseState } from "@/domain/workflow";
import { cn, Kbd } from "@/components/ui/primitives";

interface Hit {
  id: string;
  status: CaseState;
  permitNumber: string;
  address: string | null;
}

/** Ctrl/⌘+K: jump to a case by permit number or address. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const close = () => {
      setOpen(false);
      setQ("");
      setResults([]);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") close();
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pf:open-search", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pf:open-search", onOpen);
    };
  }, []);

  const searchable = q.trim().length >= 2;
  useEffect(() => {
    if (!searchable) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (res.ok) {
          setResults((await res.json()).results);
          setActive(0);
        }
      } catch {
        /* aborted */
      }
    }, 120);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, searchable]);

  if (!open) return null;
  const hits = searchable ? results : [];
  const close = () => {
    setOpen(false);
    setQ("");
    setResults([]);
  };
  const go = (h: Hit) => {
    close();
    router.push(`/cases/${h.id}`);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[14vh]" role="dialog" aria-modal="true" aria-label="Search permits">
      <div className="absolute inset-0 bg-ink/25" onClick={close} />
      <div className="relative w-full max-w-[560px] overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-pop)]">
        <div className="flex items-center gap-2.5 border-b border-line px-3.5">
          <Search className="size-4 text-muted" aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, hits.length - 1));
              if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
              if (e.key === "Enter" && hits[active]) go(hits[active]);
            }}
            placeholder="Permit number or property address…"
            aria-label="Search"
            className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto py-1.5" role="listbox">
          {hits.map((h, i) => (
            <li key={h.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(h)}
                className={cn("flex w-full items-center gap-3 px-3.5 py-2 text-left", i === active && "bg-subtle")}
              >
                <span className="font-mono text-[12.5px] font-medium">{h.permitNumber}</span>
                <span className="flex-1 truncate text-[12.5px] text-muted">{h.address ?? "No address"}</span>
                <span className="text-[11.5px] text-muted">{STATE_META[h.status].label}</span>
                <ArrowRight className="size-3.5 text-faint" aria-hidden />
              </button>
            </li>
          ))}
          {q.trim().length >= 2 && hits.length === 0 && <li className="px-3.5 py-6 text-center text-[12.5px] text-muted">No matching permits</li>}
          {q.trim().length < 2 && <li className="px-3.5 py-6 text-center text-[12.5px] text-muted">Type at least two characters</li>}
        </ul>
      </div>
    </div>
  );
}
