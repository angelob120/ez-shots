import * as React from "react";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Card({
  children,
  className,
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={cx(
        "rounded-md border border-line bg-surface",
        padded && "p-5",
        className
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-[19px] font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-dim">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "accent";
}) {
  return (
    <Card>
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-mute">{label}</div>
      <div
        className={cx(
          "mt-2 font-mono text-[26px] font-semibold tabular-nums",
          tone === "accent" ? "text-accent" : "text-ink"
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-[12px] text-dim">{hint}</div>}
    </Card>
  );
}

const BTN =
  "inline-flex items-center justify-center gap-2 rounded-sm text-[13px] font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none";

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md";
}) {
  const variants = {
    primary: "bg-accentFill text-accentInk hover:bg-accentHover",
    outline: "border border-line2 text-ink hover:bg-surface2",
    ghost: "text-dim hover:text-ink hover:bg-surface2",
    danger: "border border-badLine text-badInk hover:bg-badBg",
  };
  const sizes = { sm: "h-8 px-3", md: "h-9 px-4" };
  return <button className={cx(BTN, variants[variant], sizes[size], className)} {...props} />;
}

export function LinkButton({
  variant = "outline",
  className,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: "primary" | "outline" | "ghost" }) {
  const variants = {
    primary: "bg-accentFill text-accentInk hover:bg-accentHover",
    outline: "border border-line2 text-ink hover:bg-surface2",
    ghost: "text-dim hover:text-ink hover:bg-surface2",
  };
  return <a className={cx(BTN, variants[variant], "h-9 px-4", className)} {...props} />;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-dim">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-mute">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-sm border border-line2 bg-surface2 px-3 py-2 text-[13px] text-ink placeholder:text-mute outline-none focus:border-accentDim";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputClass, "min-h-[80px] resize-y", props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputClass, "appearance-none", props.className)} />;
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const tones = {
    neutral: "border-line2 text-dim",
    good: "border-goodLine text-good",
    warn: "border-warnLine text-warn",
    bad: "border-badLine text-badInk",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tones[tone]
      )}
    >
      {children}
    </span>
  );
}

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="hearth-scroll overflow-x-auto rounded-md border border-line bg-surface">
      <table className="w-full min-w-[560px] border-collapse text-[13px]">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={cx(
        "border-b border-line px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-mute",
        className
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cx("border-b border-line px-4 py-3 text-ink", className)}>{children}</td>;
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-md border border-dashed border-line2 px-6 py-12 text-center">
      <div className="text-[14px] font-medium text-ink">{title}</div>
      {body && <div className="mx-auto mt-1.5 max-w-sm text-[13px] text-dim">{body}</div>}
    </div>
  );
}

/** Simple bar chart — orders by hour, revenue by day, etc. No chart library. */
export function Bars({ data, unit = "" }: { data: Array<{ label: string; value: number }>; unit?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex h-[140px] items-end gap-1.5">
      {data.map((d) => (
        <div key={d.label} className="group flex flex-1 flex-col items-center gap-1.5">
          <div
            className="w-full rounded-t-[3px] bg-accentDim transition-colors group-hover:bg-accent"
            style={{ height: `${Math.max(2, (d.value / max) * 108)}px` }}
            title={`${d.label}: ${d.value}${unit}`}
          />
          <span className="text-[10px] text-mute">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Two-segment donut — new vs returning, repeat rate. */
export function Donut({
  a,
  b,
  aLabel,
  bLabel,
}: {
  a: number;
  b: number;
  aLabel: string;
  bLabel: string;
}) {
  const total = a + b || 1;
  const pct = a / total;
  const c = 2 * Math.PI * 42;
  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 100 100" className="h-[120px] w-[120px] -rotate-90">
        <circle cx="50" cy="50" r="42" fill="none" stroke="#23272d" strokeWidth="12" />
        <circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          stroke="#3b82f6"
          strokeWidth="12"
          strokeDasharray={`${c * pct} ${c}`}
          strokeLinecap="butt"
        />
      </svg>
      <div className="space-y-2 text-[13px]">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          <span className="text-dim">{aLabel}</span>
          <span className="font-mono text-ink">{a}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-line2" />
          <span className="text-dim">{bLabel}</span>
          <span className="font-mono text-ink">{b}</span>
        </div>
        <div className="pt-1 font-mono text-[15px] text-ink">{Math.round(pct * 100)}%</div>
      </div>
    </div>
  );
}
