import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Activity, ChevronDown, Command, FlaskConical, History, Menu, Settings2, X } from 'lucide-react';
import { useHealthCheck } from '@workspace/api-client-react';

const navigation = [
  { href: '/', label: 'Workspace', icon: FlaskConical },
  { href: '/history', label: 'Job history', icon: History },
  { href: '/settings', label: 'Settings', icon: Settings2 },
];

export function NeuroShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const health = useHealthCheck({ query: { queryKey: ['/api/healthz'], staleTime: 30_000 } });

  return (
    <div className="instrument-noise min-h-[100dvh] bg-background text-foreground">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[254px] flex-col bg-sidebar text-sidebar-foreground transition-transform duration-300 md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-[76px] items-center justify-between border-b border-sidebar-border px-6">
          <Link href="/" className="focus-ring flex items-center gap-3" data-testid="link-brand">
            <div className="grid size-8 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <Command size={17} strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-[15px] font-bold tracking-[.2em]">NEUROTEXT</div>
              <div className="font-mono text-[9px] uppercase tracking-[.22em] text-sidebar-foreground/50">cognitive instrument</div>
            </div>
          </Link>
          <button onClick={() => setMobileOpen(false)} className="focus-ring rounded-md p-1 text-sidebar-foreground/60 md:hidden" data-testid="button-close-menu" aria-label="Close navigation">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 px-3 py-7">
          <div className="mb-3 px-3 font-mono text-[9px] font-medium uppercase tracking-[.18em] text-sidebar-foreground/40">Instrument panel</div>
          <nav className="space-y-1">
            {navigation.map(({ href, label, icon: Icon }) => {
              const active = href === '/' ? location === '/' : location.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className={`focus-ring group flex items-center gap-3 rounded-lg px-3 py-3 text-[13px] font-medium transition-colors ${active ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground'}`}
                  data-testid={`link-nav-${label.toLowerCase().replace(' ', '-')}`}
                >
                  <Icon size={17} strokeWidth={active ? 2.3 : 1.8} />
                  <span>{label}</span>
                  {active && <span className="ml-auto size-1.5 rounded-full bg-sidebar-primary-foreground/80" />}
                </Link>
              );
            })}
          </nav>

          <div className="mt-10 rounded-lg border border-sidebar-border bg-sidebar-accent/50 p-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-[.15em] text-sidebar-foreground/45">Provider mesh</span>
              <span className={`size-1.5 rounded-full ${health.isError ? 'bg-destructive' : 'animate-pulse-dot bg-sidebar-primary'}`} />
            </div>
            <div className="space-y-2.5">
              {['ZHI / core', 'ZHI / reasoning', 'ZHI / style'].map((provider, index) => (
                <div key={provider} className="flex items-center justify-between text-[11px]">
                  <span className="text-sidebar-foreground/65">{provider}</span>
                  <span className="font-mono text-[9px] text-sidebar-primary">{health.isLoading ? '—' : index === 1 ? 'standby' : 'ready'}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 border-t border-sidebar-border pt-3 font-mono text-[9px] text-sidebar-foreground/35">
              {health.isError ? 'mesh unreachable' : 'latency nominal · 6 nodes'}
            </div>
          </div>
        </div>

        <div className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-3 rounded-lg p-2">
            <div className="grid size-8 place-items-center rounded-full bg-[#ef7655] text-[11px] font-bold text-[#12232f]">AR</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium">Ari Rowan</div>
              <div className="truncate font-mono text-[9px] text-sidebar-foreground/40">research workspace</div>
            </div>
            <ChevronDown size={14} className="text-sidebar-foreground/40" />
          </div>
        </div>
      </aside>

      {mobileOpen && <button className="fixed inset-0 z-30 bg-[#12232f]/55 md:hidden" onClick={() => setMobileOpen(false)} data-testid="button-dismiss-menu" aria-label="Dismiss navigation" />}
      <div className="md:pl-[254px]">
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-border/80 bg-background/90 px-5 backdrop-blur-md md:px-9">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="focus-ring rounded-md p-2 md:hidden" data-testid="button-open-menu" aria-label="Open navigation"><Menu size={19} /></button>
            <div className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">
              {location === '/' ? 'workspace / overview' : location.slice(1).replace('-', ' ') + ' / index'}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-2 font-mono text-[10px] text-muted-foreground sm:flex">
              <Activity size={13} className={health.isError ? 'text-destructive' : 'text-[#6caeb0]'} />
              <span>{health.isError ? 'offline' : 'all systems nominal'}</span>
            </div>
            <div className="h-4 w-px bg-border" />
            <span className="font-mono text-[10px] text-muted-foreground">ZHI-06</span>
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}