import Link from "next/link";
import { buttonClass } from "@/components/ui/primitives";
import { qs } from "./filters";

export function Pagination({ base, params, page, pageSize, total }: { base: string; params: Record<string, string | undefined>; page: number; pageSize: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-[12px] text-muted">
      <span className="tabular">
        {from}–{to} of {total}
      </span>
      <div className="flex gap-1.5">
        {page > 1 ? (
          <Link className={buttonClass("secondary", "sm")} href={qs(base, { ...params, page: page - 1 })}>
            Previous
          </Link>
        ) : (
          <span className={buttonClass("secondary", "sm", "pointer-events-none opacity-50")}>Previous</span>
        )}
        {page < pages ? (
          <Link className={buttonClass("secondary", "sm")} href={qs(base, { ...params, page: page + 1 })}>
            Next
          </Link>
        ) : (
          <span className={buttonClass("secondary", "sm", "pointer-events-none opacity-50")}>Next</span>
        )}
      </div>
    </div>
  );
}
