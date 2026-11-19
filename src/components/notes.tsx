import { Clock3, ShieldCheck } from "lucide-react";
import { cx } from "./ui";

/**
 * The two statements the product makes about deal data. They are worded once, here, and
 * the end-to-end privacy tests assert the behaviour they describe: no request carries
 * file contents, and nothing is written to browser storage.
 */
export const PRIVACY_NOTE = "Your files are processed in this browser. They aren't sent to Autheo or stored on our servers.";
export const SESSION_NOTE = "Closing or refreshing this tab clears your work. Download your results before you leave.";

export function PrivacyNote({ className }: { className?: string }) {
  return (
    <p data-testid="privacy-note" className={cx("flex items-start gap-2 text-[13px] leading-relaxed text-ink-2", className)}>
      <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
      <span>{PRIVACY_NOTE}</span>
    </p>
  );
}

export function SessionNote({ className }: { className?: string }) {
  return (
    <p data-testid="session-note" className={cx("flex items-start gap-2 text-[13px] leading-relaxed text-ink-2", className)}>
      <Clock3 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
      <span>{SESSION_NOTE}</span>
    </p>
  );
}
