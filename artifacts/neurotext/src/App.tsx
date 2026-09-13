import { type ReactNode } from 'react';
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
import { useGetUsage } from '@workspace/api-client-react';

const queryClient = new QueryClient();

function SharedShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { data: usage } = useGetUsage();
  
  return (
    <div className="min-h-screen flex flex-col bg-background font-sans text-foreground">
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="font-bold tracking-widest text-[13px] text-foreground">NEUROTEXT</span>
            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">UK</span>
          </Link>
          
          <nav className="flex items-center gap-6 text-sm font-semibold">
            <Link href="/">
              <span className={`cursor-pointer transition-colors hover:text-foreground ${location === '/' ? 'text-foreground' : 'text-muted-foreground'}`}>
                Workspace
              </span>
            </Link>
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
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </SharedShell>
  );
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
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
