import { type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({ open, title, eyebrow, onClose, children, wide = false }: { open: boolean; title: string; eyebrow?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#12232f]/55 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`animate-rise-in w-full rounded-xl border border-border bg-card p-6 shadow-2xl ${wide ? 'max-w-2xl' : 'max-w-lg'}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="mb-6 flex items-start justify-between">
          <div>
            {eyebrow && <div className="mb-1 font-mono text-[9px] uppercase tracking-[.18em] text-[#6caeb0]">{eyebrow}</div>}
            <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          </div>
          <button onClick={onClose} className="focus-ring rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" data-testid="button-close-dialog" aria-label="Close dialog"><X size={18} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}