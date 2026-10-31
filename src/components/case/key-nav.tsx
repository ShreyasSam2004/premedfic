"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Keyboard navigation between evidence items: [ previous, ] next. */
export function KeyNav({ prev, next }: { prev: string | null; next: string | null }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "[" && prev) router.push(prev);
      if (e.key === "]" && next) router.push(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, router]);
  return null;
}
