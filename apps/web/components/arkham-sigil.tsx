export function ArkhamSigil({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path d="M32 4 53 16v24L32 60 11 40V16L32 4Z" stroke="currentColor" strokeWidth="1.2" />
      <path d="m32 12 13 10-5 18-17 7-5-18 14-17Z" stroke="currentColor" strokeWidth="1.1" />
      <path d="m18 29 22-7-8 25-14-18Zm14-17v35M11 16l42 24M53 16 11 40" stroke="currentColor" strokeWidth=".65" opacity=".72" />
      <circle cx="32" cy="31" r="3.5" fill="currentColor" />
    </svg>
  );
}
