import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
};

export default function ActionButton({
  children,
  variant = "secondary",
  size = "md",
  loading,
  className,
  disabled,
  ...props
}: Props) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cn("action-button", `action-button--${variant}`, `action-button--${size}`, className)}
    >
      {loading && <LoaderCircle className="action-button__spinner" aria-hidden="true" />}
      <span>{children}</span>
    </button>
  );
}
