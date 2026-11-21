import { useEffect, useRef, useState } from 'react';
import { useGetBilling, getGetBillingQueryKey, useGetAccount, useCreateCheckout, useConfirmBilling, useOpenBillingPortal } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from './ui/button';
import { prepareBillingNavigation } from '@/hooks/use-payment-draft';
import { errorMessage } from '@/lib/private-utils';

export function BillingControls() {
  const cache = useQueryClient();
  const { data: billing, isLoading } = useGetBilling({ query: { queryKey: getGetBillingQueryKey(), refetchOnWindowFocus: true, staleTime: 10000 } });
  const { data: account } = useGetAccount();
  const checkout = useCreateCheckout();
  const confirm = useConfirmBilling();
  const portal = useOpenBillingPortal();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [leaving, setLeaving] = useState(false);
  const handledReturn = useRef(false);
  const verify = async (sessionId?: string) => {
    try {
      const result = await confirm.mutateAsync({ data: sessionId ? { sessionId } : {} });
      setNotice(result.fullAccess ? 'Payment verified. Full access is active; run your function again for a complete answer.' : 'Payment is not confirmed yet. You have not been granted full access. Check again after Stripe completes the payment.');
      // Clear previews from memory so an old fragment is never mistaken for
      // a complete paid answer. Persisted drafts remain on the server.
      await cache.invalidateQueries();
    } catch (e) { setError(errorMessage(e, 'Payment could not be verified.')); }
  };
  useEffect(() => {
    if (handledReturn.current || !billing) return;
    const url = new URL(window.location.href);
    const status = url.searchParams.get('checkout');
    if (!status) return;
    handledReturn.current = true;
    if (status === 'success' && billing.signedIn) void verify(url.searchParams.get('session_id') || undefined);
    if (status === 'cancelled') setNotice('Checkout was cancelled. No new access was granted. Your saved inputs remain available.');
    url.searchParams.delete('checkout'); url.searchParams.delete('session_id');
    window.history.replaceState(null, '', url);
  }, [billing]);
  const navigate = async (action: 'login' | 'checkout' | 'portal') => {
    setError(''); setLeaving(true);
    try {
      await prepareBillingNavigation();
      if (action === 'login') { window.location.assign(import.meta.env.BASE_URL + 'api/auth/google'); return; }
      const result = action === 'checkout' ? await checkout.mutateAsync() : await portal.mutateAsync();
      const target = new URL(result.url);
      if (target.protocol !== 'https:' || !['checkout.stripe.com', 'billing.stripe.com'].includes(target.hostname)) throw new Error('Stripe returned an unexpected destination.');
      window.location.assign(target.href);
    } catch (e) { setError(errorMessage(e, 'Payment navigation failed.')); setLeaving(false); }
  };
  if (account?.developmentOwner || account?.owner) return null;
  const amount = billing?.price ? new Intl.NumberFormat(undefined, { style: 'currency', currency: billing.price.currency }).format(billing.price.amount / 100) : '';
  const interval = billing?.price?.interval ? ` every ${billing.price.intervalCount > 1 ? billing.price.intervalCount + ' ' : ''}${billing.price.interval}${billing.price.intervalCount > 1 ? 's' : ''}` : '';
  return (
    <section className="border-b bg-primary/5" data-testid="billing-controls">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-4 text-sm space-y-2">
        {isLoading ? <p>Checking access…</p> : billing?.fullAccess ? (
          <div className="flex flex-wrap items-center gap-3"><strong>Paid full access is active.</strong><Button variant="outline" size="sm" onClick={() => void navigate('portal')} disabled={leaving}>Manage billing</Button></div>
        ) : (
          <>
            <p className="font-semibold">Preview only. Complete answers require Google sign-in AND payment.</p>
            <p className="text-xs text-muted-foreground">Shorter answers show half. Longer answers show no more than 5%, capped at 500 words. Previews can end mid-argument or mid-equation.</p>
            <div className="flex flex-wrap items-center gap-3">
              {!billing?.signedIn ? <Button size="sm" onClick={() => void navigate('login')} disabled={leaving || account?.googleConfigured === false} data-testid="button-payment-login">Sign in with Google to pay</Button> : <>
                <Button size="sm" onClick={() => void navigate('checkout')} disabled={leaving || !billing.checkoutConfigured} data-testid="button-upgrade">{leaving ? 'Opening Stripe…' : `Get full access${amount ? ' — ' + amount + interval : ''}`}</Button>
                <Button size="sm" variant="outline" onClick={() => void verify()} disabled={confirm.isPending}>Check payment status</Button>
                <Button size="sm" variant="outline" onClick={() => void navigate('portal')} disabled={leaving}>Manage billing</Button>
              </>}
              {billing?.price?.interval && <span className="text-xs">{amount}{interval}. Automatically renews until cancelled through Manage billing.</span>}
              {billing && !billing.checkoutConfigured && <span className="text-xs text-destructive">Checkout is temporarily unavailable. Full answers remain locked.</span>}
            </div>
          </>
        )}
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </div>
    </section>
  );
}
