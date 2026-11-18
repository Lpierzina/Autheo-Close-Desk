import { cx } from "./ui";

export function Brand({ tone = "dark" }: { tone?: "dark" | "light" }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className={cx(
          "flex h-7 w-7 items-center justify-center rounded-md text-[13px] font-semibold",
          tone === "dark" ? "bg-white/10 text-white ring-1 ring-white/15" : "bg-navy-900 text-white",
        )}
      >
        A
      </span>
      <span className="leading-tight">
        <span className={cx("block text-[11px] font-medium uppercase tracking-[0.14em]", tone === "dark" ? "text-navy-300" : "text-ink-3")}>
          Autheo
        </span>
        <span className={cx("block text-sm font-semibold", tone === "dark" ? "text-white" : "text-ink")}>Close Desk</span>
      </span>
    </div>
  );
}
