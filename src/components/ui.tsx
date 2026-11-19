import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-strong",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-paper-2",
  ghost: "text-ink-2 hover:bg-paper-2 hover:text-ink",
  danger: "border border-danger-line bg-surface text-danger hover:bg-danger-soft",
};

export function buttonClass(variant: ButtonVariant = "secondary", className?: string): string {
  return cx(BUTTON_BASE, BUTTON_VARIANT[variant], className);
}

export function Button({ variant = "secondary", className, ...props }: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return <button type="button" {...props} className={buttonClass(variant, className)} />;
}

export function ButtonLink({
  variant = "secondary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link {...props} className={buttonClass(variant, className)} />;
}

export function Card({ className, children, ...props }: ComponentProps<"section">) {
  return (
    <section {...props} className={cx("rounded-lg border border-line bg-surface", className)}>
      {children}
    </section>
  );
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] text-ink-3">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? <div className="mb-1 text-xs font-medium uppercase tracking-wider text-ink-3">{eyebrow}</div> : null}
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export type Tone = "neutral" | "ok" | "warn" | "danger" | "info";

const TONE: Record<Tone, string> = {
  neutral: "border-line-strong bg-paper-2 text-ink-2",
  ok: "border-accent-line bg-accent-soft text-accent-strong",
  warn: "border-warn-line bg-warn-soft text-warn",
  danger: "border-danger-line bg-danger-soft text-danger",
  info: "border-line-strong bg-surface text-ink-2",
};

export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", TONE[tone], className)}>
      {children}
    </span>
  );
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  ready: { label: "Ready", tone: "ok" },
  needs_review: { label: "Needs review", tone: "warn" },
  blocked: { label: "Blocked", tone: "danger" },
};

export function StatusPill({ status }: { status: "ready" | "needs_review" | "blocked" }) {
  const { label, tone } = STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return (
    <Pill tone={tone}>
      <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", tone === "ok" ? "bg-accent" : tone === "warn" ? "bg-warn" : "bg-danger")} />
      {label}
    </Pill>
  );
}

const CALLOUT_ICON = { info: Info, ok: CheckCircle2, warn: AlertTriangle, danger: OctagonAlert, neutral: Info } as const;

export function Callout({ tone = "info", title, children, className, role }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string; role?: "alert" | "status" }) {
  const Icon = CALLOUT_ICON[tone];
  return (
    <div role={role} className={cx("flex gap-3 rounded-md border px-4 py-3 text-sm", TONE[tone], className)}>
      <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cx(title ? "mt-0.5" : "", "text-[13px] leading-relaxed")}>{children}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon ? <div className="mb-3 text-ink-3">{icon}</div> : null}
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-ink-3">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Field({ label, htmlFor, hint, error, children, optional }: { label: string; htmlFor: string; hint?: ReactNode; error?: string | null; children: ReactNode; optional?: boolean }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-ink">
        {label}
        {optional ? <span className="ml-1.5 font-normal text-ink-3">Optional</span> : null}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${htmlFor}-hint`} className="mt-1.5 text-xs text-ink-3">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="mt-1.5 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const inputClass =
  "block w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:bg-paper-2";

export function Th({ children, className, ...props }: ComponentProps<"th">) {
  return (
    <th scope="col" {...props} className={cx("whitespace-nowrap px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-ink-3", className)}>
      {children}
    </th>
  );
}

export function Td({ children, className, ...props }: ComponentProps<"td">) {
  return (
    <td {...props} className={cx("px-3 py-2.5 align-top text-[13px] text-ink", className)}>
      {children}
    </td>
  );
}
