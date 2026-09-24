import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: ReactNode;
  error?: string;
};

export default function Field({ label, hint, error, className, id, ...props }: FieldProps) {
  const inputId = id || props.name;
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <input
        {...props}
        id={inputId}
        className={cn("field-input", error && "field-input--error", className)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
      />
      {hint && !error && <span id={`${inputId}-hint`} className="field-hint">{hint}</span>}
      {error && <span id={`${inputId}-error`} className="field-error">{error}</span>}
    </div>
  );
}
