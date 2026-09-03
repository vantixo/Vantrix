"use client";

import { cn } from "@/lib/utils";

const inputClass =
  "w-full rounded-sm bg-base border border-interactive px-4 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60";

function FieldWrap({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-text-secondary mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-text-tertiary mt-1">{hint}</p>}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  maxLength,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <FieldWrap label={label}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(inputClass, "h-11", disabled && "opacity-50 cursor-not-allowed")}
      />
    </FieldWrap>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  maxLength,
  rows = 3,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <FieldWrap label={label} hint={maxLength ? `${value.length} / ${maxLength}` : undefined}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(inputClass, "py-2.5 resize-none", disabled && "opacity-50 cursor-not-allowed")}
      />
    </FieldWrap>
  );
}

// String[] columns (values_list, fears, flaws, dreams, secrets,
// friends_list, daily_routine) edited as a comma-separated line —
// simplest input that round-trips cleanly with the schema's
// z.array(z.string()).max(20) without a whole chip-input widget.
export function TagListField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  return (
    <FieldWrap label={label} hint="Comma-separated">
      <input
        defaultValue={value.join(", ")}
        onBlur={(e) =>
          onChange(
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
              .slice(0, 20)
          )
        }
        placeholder={placeholder}
        className={cn(inputClass, "h-11")}
      />
    </FieldWrap>
  );
}

export function SliderField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-sm font-medium text-text-secondary">{label}</label>
        <span className="text-xs text-gold-400 font-semibold tabular-nums">{value}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-gold-500"
      />
    </div>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  hint?: string;
}) {
  return (
    <FieldWrap label={label} hint={hint}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputClass, "h-11")}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldWrap>
  );
}

// Json | null columns (voice_profile, writing_style) — a raw JSON
// textarea. Parsing happens at save time in the parent form; this just
// carries the text and an optional invalid-JSON flag for the border color.
export function JsonField({
  label,
  value,
  onChange,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
}) {
  return (
    <FieldWrap label={label} hint={invalid ? "Invalid JSON — changes here won't save" : "Raw JSON object"}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className={cn(
          inputClass,
          "py-2.5 resize-none font-mono text-xs",
          invalid && "border-danger/60"
        )}
      />
    </FieldWrap>
  );
}
