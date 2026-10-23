import lockupGold from "@/assets/brand/lockup-gold.png";
import markGold from "@/assets/brand/mark-gold.png";
import wordGold from "@/assets/brand/wordmark-gold.png";
import wordNavy from "@/assets/brand/wordmark-navy.png";
import { cx } from "./ui";

// The firm's own logo (key and house, LEGAL ESTATE, "Aste immobiliari con tutela legale"). On light
// surfaces the wordmark is navy, since the gold gradient alone is too faint on white.

export function LogoMark({ className = "h-8" }: { className?: string }) {
  return <img src={markGold} alt="" aria-hidden className={cx("w-auto select-none", className)} />;
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5" role="img" aria-label="Legal Estate">
      <LogoMark className="h-7" />
      {!compact && (
        <>
          <img src={wordNavy} alt="" aria-hidden className="h-[13px] w-auto select-none dark:hidden" />
          <img src={wordGold} alt="" aria-hidden className="hidden h-[13px] w-auto select-none dark:block" />
        </>
      )}
    </span>
  );
}

/** The full logo with the tagline, for navy surfaces. */
export function LogoLockup({ className }: { className?: string }) {
  return <img src={lockupGold} alt="Legal Estate, aste immobiliari con tutela legale" className={cx("h-auto select-none", className)} />;
}
