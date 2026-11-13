import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useGetAccount, useLogoutAccount } from '@workspace/api-client-react';
import { LogIn, LogOut, X } from 'lucide-react';
import { errorMessage } from '@/lib/private-utils';

const AUTH_ERRORS: Record<string, string> = {
  google_login_failed: 'Google sign-in failed. Please try again. If it continues, check that this site’s callback URL is registered with Google.',
  not_configured: 'Google sign-in is not configured on this server.',
  state: 'Sign-in session expired or was tampered with. Please try again.',
  denied: 'Google sign-in was cancelled.',
};

export function AccountControls() {
  const queryClient = useQueryClient();
  const { data: account, isLoading } = useGetAccount();
  const [authError, setAuthError] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('authError');
  });
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const logout = useLogoutAccount({
    mutation: {
      onSuccess: async () => {
        await queryClient.cancelQueries();
        queryClient.clear();
        window.location.reload();
      },
      onError: (e) => setLogoutError(errorMessage(e, 'Sign-out failed.')),
    },
  });

  const dismissAuthError = () => {
    setAuthError(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('authError');
    window.history.replaceState(null, '', url.toString());
  };

  const loginHref = import.meta.env.BASE_URL + 'api/auth/google';
  const user = account?.user;

  return (
    <div className="relative flex items-center gap-3 text-xs" data-testid="account-controls">
      {isLoading ? (
        <span className="h-4 w-16 rounded bg-muted animate-pulse" />
      ) : user ? (
        <>
          <Link href="/library" className="text-muted-foreground hover:text-foreground font-semibold" data-testid="link-library">Library</Link>
          <Link href="/history" className="text-muted-foreground hover:text-foreground font-semibold" data-testid="link-history">Past work</Link>
          <span className="hidden md:inline text-muted-foreground max-w-[160px] truncate" title={user.email} data-testid="text-account-email">{user.email}</span>
          <button
            type="button"
            onClick={() => { setLogoutError(null); logout.mutate(); }}
            disabled={logout.isPending}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 font-semibold hover:bg-muted disabled:opacity-50"
            data-testid="button-logout"
          >
            <LogOut className="h-3 w-3" /> {logout.isPending ? 'Signing out' : 'Sign out'}
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={() => setShowInfo((v) => !v)} className="text-muted-foreground hover:text-foreground font-semibold" data-testid="button-account-info">
            Anonymous
          </button>
          {account?.googleConfigured === false ? (
            <span className="text-muted-foreground" data-testid="text-google-unavailable">Sign-in unavailable</span>
          ) : (
            <a href={loginHref} className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 font-semibold text-primary-foreground hover:bg-primary/90" data-testid="link-google-login">
              <LogIn className="h-3 w-3" /> Sign in with Google
            </a>
          )}
        </>
      )}
      {showInfo && !user ? (
        <div className="absolute right-0 top-8 z-50 w-72 rounded-lg border border-border bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-lg" data-testid="text-anonymous-info">
          <div className="flex justify-between gap-2">
            <p>You are working anonymously. Generation works fully, but nothing is saved after you reload the page. Signing in is optional and only needed for a private library of extracted texts and a record of past work.</p>
            <button type="button" onClick={() => setShowInfo(false)} aria-label="Close" data-testid="button-close-info"><X className="h-3 w-3" /></button>
          </div>
        </div>
      ) : null}
      {authError || logoutError ? (
        <div className="absolute right-0 top-8 z-50 w-72 rounded-lg border border-destructive/40 bg-popover p-3 text-xs text-destructive shadow-lg" role="alert" data-testid="text-auth-error">
          <div className="flex justify-between gap-2">
            <p>{logoutError ?? AUTH_ERRORS[authError!] ?? 'Google sign-in failed: ' + authError}</p>
            <button type="button" onClick={() => { setLogoutError(null); if (authError) dismissAuthError(); }} aria-label="Dismiss" data-testid="button-dismiss-auth-error"><X className="h-3 w-3" /></button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
