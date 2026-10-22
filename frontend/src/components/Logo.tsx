export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="16" className="fill-[#0b263b] dark:fill-[#e8bd38]" />
      <g fill="none" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="stroke-[#e0b31d] dark:stroke-[#0b1118]">
        <circle cx="22" cy="36" r="8" />
        <path d="M30 36h22M44 36v7M50 36v5" />
        <path d="M34 27l9-9 9 9" />
      </g>
    </svg>
  );
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark />
      {!compact && (
        <span className="leading-none">
          <span className="block font-serif text-[17px] font-semibold tracking-tight text-navy">Legal Estate</span>
          <span className="block text-[10.5px] font-medium uppercase tracking-[0.14em] text-gold">Aste</span>
        </span>
      )}
    </span>
  );
}
