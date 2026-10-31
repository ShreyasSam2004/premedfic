export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-pulse space-y-4">
      <div className="h-6 w-56 rounded bg-line" />
      <div className="h-4 w-96 max-w-full rounded bg-line/70" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 rounded-[var(--radius-card)] border border-line bg-surface" />
        ))}
      </div>
      <div className="h-72 rounded-[var(--radius-card)] border border-line bg-surface" />
    </div>
  );
}
