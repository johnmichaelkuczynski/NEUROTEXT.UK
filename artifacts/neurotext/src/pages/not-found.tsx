import { ArrowLeft, Compass } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="instrument-grid flex min-h-[calc(100dvh-76px)] items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-full border border-[#ef7655]/40 bg-[#ef7655]/10 text-[#c4563d]"><Compass size={24} /></div>
        <div className="mt-6 font-mono text-[10px] uppercase tracking-[.22em] text-[#4f9698]">Signal not found / 404</div>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-.04em]">This coordinate is outside the instrument.</h1>
        <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">The page you requested is not part of this workspace. Return to the command center to continue.</p>
        <Link href="/" className="focus-ring mx-auto mt-7 flex w-fit items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-[11px] font-semibold text-primary-foreground hover:opacity-90" data-testid="link-return-workspace"><ArrowLeft size={14} /> Return to workspace</Link>
      </div>
    </div>
  );
}
