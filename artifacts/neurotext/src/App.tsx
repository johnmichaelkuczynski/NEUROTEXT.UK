import { type ReactNode, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Dashboard from '@/pages/Dashboard';
import Diagnostics from '@/pages/Diagnostics';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
  Link
} from 'wouter';
import { useGetAccount, getGetAccountQueryKey, useGetUsage, useRegisterVisitor } from '@workspace/api-client-react';
import { AccountControls } from '@/components/account-controls';
import Library from '@/pages/Library';
import History from '@/pages/History';

const queryClient = new QueryClient();

function SharedShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { data: usage } = useGetUsage();
  const [visitorCount, setVisitorCount] = useState<number | null>(null);
  const registrationStarted = useRef(false);
  const registerVisitor = useRegisterVisitor({
    mutation: {
      onSuccess: (result) => setVisitorCount(result.visitorCount),
    },
  });

  useEffect(() => {
    if (registrationStarted.current) return;
    registrationStarted.current = true;
    const storageKey = 'neurotext_visitor_id';
    let visitorId = window.localStorage.getItem(storageKey);
    if (!visitorId) {
      visitorId = window.crypto.randomUUID();
      window.localStorage.setItem(storageKey, visitorId);
    }
    registerVisitor.mutate({ data: { visitorId } });
  }, [registerVisitor.mutate]);

  useEffect(() => {
    if (visitorCount === null && usage) setVisitorCount(usage.visitorCount);
  }, [usage, visitorCount]);
  
  return (
    <div className="min-h-screen flex flex-col bg-background font-sans text-foreground">
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 min-h-14 py-3 flex flex-wrap gap-3 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="font-bold tracking-widest text-[13px] text-foreground">NEUROTEXT</span>
            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">UK</span>
          </Link>
          
          <nav className="flex flex-wrap items-center gap-3 sm:gap-6 text-sm font-semibold">
            <div
              className="text-xs font-semibold tabular-nums text-muted-foreground"
              aria-label={`${visitorCount ?? usage?.visitorCount ?? 0} total visitors`}
              data-testid="visitor-counter"
            >
              Visitors {(visitorCount ?? usage?.visitorCount ?? 0).toLocaleString()}
            </div>
            <Link href="/">
              <span className={`cursor-pointer transition-colors hover:text-foreground ${location === '/' ? 'text-foreground' : 'text-muted-foreground'}`}>
                Workspace
              </span>
            </Link>
            <AccountControls />
            <Link href="/diagnostics">
              <span className={`cursor-pointer transition-colors hover:text-foreground ${location === '/diagnostics' ? 'text-foreground' : 'text-muted-foreground'}`}>
                Diagnostics
              </span>
            </Link>
            
            {usage?.accessState === 'owner' || usage?.accessState === 'development-owner' ? (
               <div className="text-[10px] bg-amber-500/10 text-amber-700 px-2 py-1 rounded font-bold uppercase tracking-wider ml-4">
                 Owner
               </div>
            ) : null}
          </nav>
        </div>
      </header>
      
      <div className="flex-1 flex flex-col">
        {children}
      </div>
    </div>
  );
}

function Router() {
  return (
    <SharedShell>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/diagnostics" component={Diagnostics} />
          <Route path="/library" component={Library} />
          <Route path="/history" component={History} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </SharedShell>
  );
}

// A changed account in another tab must not inherit the previous account's
// cached workspace or mounted form state. OAuth and logout already reload.
function AccountScope() {
  const account = useGetAccount({ query: { queryKey: getGetAccountQueryKey(), staleTime: 0, refetchOnWindowFocus: true } });
  const initialIdentity = useRef<string | null>(null);
  const identity = account.data ? account.data.user?.id || 'anonymous' : null;
  if (identity && initialIdentity.current === null) initialIdentity.current = identity;
  const changed = identity !== null && initialIdentity.current !== identity;
  useEffect(() => {
    if (!changed) return;
    void queryClient.cancelQueries().then(() => {
      queryClient.clear();
      window.location.reload();
    });
  }, [changed]);
  if (changed) return null;
  return <Router />;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <AccountScope />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
