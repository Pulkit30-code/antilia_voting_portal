import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

type FieldShellProps = {
  children: ReactNode;
  error?: string;
  hint?: string;
  id: string;
  label: string;
};

function FieldShell({ children, error, hint, id, label }: FieldShellProps) {
  const description = error ?? hint;
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-[#eee8dc]">
        {label}
      </label>
      {children}
      {description ? (
        <p id={`${id}-description`} className={`text-xs ${error ? "text-[#e9a89b]" : "text-[#999184]"}`}>
          {description}
        </p>
      ) : null}
    </div>
  );
}

const fieldClass =
  "min-h-12 w-full rounded-xl border border-white/10 bg-[#1b1b18] px-4 py-3 text-base text-[#f7f2e8] outline-none transition placeholder:text-[#777166] hover:border-white/20 focus:border-[#b99a5f]/70 focus:ring-4 focus:ring-[#b99a5f]/10 disabled:cursor-not-allowed disabled:opacity-60";

export function Input({
  error,
  hint,
  id,
  label,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & Omit<FieldShellProps, "children">) {
  return (
    <FieldShell error={error} hint={hint} id={id} label={label}>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? `${id}-description` : undefined}
        className={`${fieldClass} ${error ? "border-[#c97060]/70" : ""} ${className}`}
        {...props}
      />
    </FieldShell>
  );
}

export function Select({
  children,
  error,
  hint,
  id,
  label,
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & Omit<FieldShellProps, "children"> & { children: ReactNode }) {
  return (
    <FieldShell error={error} hint={hint} id={id} label={label}>
      <select
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? `${id}-description` : undefined}
        className={`${fieldClass} appearance-none bg-[linear-gradient(45deg,transparent_50%,#9b927f_50%),linear-gradient(135deg,#9b927f_50%,transparent_50%)] bg-[position:calc(100%-20px)_50%,calc(100%-15px)_50%] bg-[size:5px_5px,5px_5px] bg-no-repeat pr-11 ${error ? "border-[#c97060]/70" : ""} ${className}`}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
}
