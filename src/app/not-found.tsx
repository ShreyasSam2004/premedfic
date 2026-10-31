import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-[13px] font-medium text-muted">404</p>
      <h1 className="mt-1 text-[20px] font-semibold">Not found</h1>
      <p className="mt-1 max-w-sm text-[13px] text-muted">The record does not exist or you do not have access to it.</p>
      <Link href="/overview" className="mt-4 text-[13px] font-medium text-brand hover:underline">
        Back to overview
      </Link>
    </main>
  );
}
