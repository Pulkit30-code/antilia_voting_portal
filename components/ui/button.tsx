import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-[#b99a5f] text-[#141310] shadow-[0_10px_28px_rgba(185,154,95,0.18)] hover:bg-[#c9ab70] disabled:bg-[#71654e] disabled:text-[#b9b1a2]",
  secondary:
    "border border-white/12 bg-white/[0.055] text-[#f4efe5] hover:border-[#b99a5f]/45 hover:bg-white/[0.08]",
  ghost: "text-[#c8c1b5] hover:bg-white/[0.055] hover:text-[#f7f2e8]",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: ButtonVariant;
  fullWidth?: boolean;
};

export function Button({
  children,
  className = "",
  variant = "primary",
  fullWidth = false,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold tracking-wide transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8a96b] focus-visible:ring-offset-2 focus-visible:ring-offset-[#11110f] disabled:cursor-not-allowed disabled:opacity-70 ${variants[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
