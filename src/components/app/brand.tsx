export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden className="shrink-0">
      <rect width="28" height="28" rx="7" fill="#2f4fd8" />
      <path d="M8 9.5h7.25a3.75 3.75 0 0 1 0 7.5H11.5v2.5" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m15.5 19.25 1.75 1.75 3.5-3.75" fill="none" stroke="#a9b8f5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
