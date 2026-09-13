import { type ReactNode, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import Neurotext from '@/pages/neurotext';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

export type AuthUser = { id: string; email: string; name: string; picture?: string };

function api(path: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/api${path}`;
}

function Router() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    fetch(api('/auth/me'), { credentials: 'include' })
      .then(async (response) => {
        if (response.status === 401) return null;
        if (!response.ok) throw new Error();
        return (await response.json() as { user: AuthUser }).user;
      })
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  const logout = async () => {
    await fetch(api('/auth/logout'), { method: 'POST', credentials: 'include' });
    setUser(null);
  };

  const ownerAccess = user?.id === 'development-owner'
    || user?.email.trim().toLowerCase() === 'johnmichaelkuczynski@gmail.com';

  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/diagnostics">{() => user === undefined
          ? <div className="min-h-screen bg-[#f7f8fa] p-8 text-[#152238]">Checking owner access…</div>
          : ownerAccess
            ? <Neurotext user={user} onLogout={logout} loginUrl={api('/auth/google')} diagnosticsOnly />
            : <div className="flex min-h-screen items-center justify-center bg-[#f7f8fa] p-8 text-[#152238]"><div className="rounded-xl border border-[#dce1e9] bg-white p-8 text-center shadow-sm"><h1 className="text-2xl font-bold">Access denied</h1><p className="mt-3 text-[#56647a]">This diagnostic page is restricted to the permanent owner.</p><a href={import.meta.env.BASE_URL} className="mt-5 inline-block font-semibold text-[#1e64c8] hover:underline">Return to NEUROTEXT</a></div></div>}</Route>
        <Route path="/">{() => <Neurotext user={user ?? null} onLogout={logout} loginUrl={api('/auth/google')} />}</Route>
        <Route>{() => <Neurotext user={user ?? null} onLogout={logout} loginUrl={api('/auth/google')} />}</Route>
      </Switch>
    </RoutedErrorBoundary>
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
