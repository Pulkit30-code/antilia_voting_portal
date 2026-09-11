"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";

export function Modal({ children, onClose, open, title }: { children: ReactNode; onClose: () => void; open: boolean; title: string }) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = "";
    };
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="confirmation-title" className="w-full max-w-lg rounded-t-2xl border border-white/10 bg-[#1a1a17] p-5 shadow-2xl animate-[rise_.22s_ease-out] sm:rounded-2xl sm:p-7">
        <div className="flex items-center justify-between gap-4">
          <h2 id="confirmation-title" className="font-serif text-2xl text-[#f7f1e6]">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close confirmation" className="rounded-lg p-2 text-[#918a7e] transition hover:bg-white/5 hover:text-white">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
