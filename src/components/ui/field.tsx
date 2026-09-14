import { cn, normalizeHhmm } from "@/lib/utils";
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

export function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex min-w-0 w-full flex-col gap-1.5", className)}>
      <span className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</span>
      {children}
    </label>
  );
}

const control =
  "box-border min-h-11 w-full min-w-0 max-w-full rounded-lg border border-line bg-paper px-3 py-2.5 text-sm text-ink outline-none transition-shadow duration-150 focus:border-cyan focus:ring-2 focus:ring-cyan/20";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "min-h-24 resize-y", className)} {...props} />;
}

export function HhmmInput({
  value,
  onChange,
  onBlur,
  className,
}: {
  value: string;
  onChange: (hhmm: string) => void;
  onBlur?: () => void;
  className?: string;
}) {
  return (
    <Input
      className={className}
      value={value}
      inputMode="numeric"
      placeholder="0700"
      autoComplete="off"
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
      onBlur={(e) => {
        onChange(normalizeHhmm(e.target.value, value));
        onBlur?.();
      }}
    />
  );
}
