import { useEffect, useRef } from 'react';
import type { WorkspaceInput } from '@workspace/api-client-react';

type Handoff = { functionId: number; workspace: WorkspaceInput };
export function usePaymentDraft(functionId: number, value: Partial<WorkspaceInput>) {
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    const collect = (event: Event) => {
      const detail = (event as CustomEvent<{ draft?: Handoff }>).detail;
      detail.draft = { functionId, workspace: {
        instructions: '', instructionDraft: '', sourceDocument: '', targetWords: 500,
        selectedModel: 'ZHI 6 · Perplexity Sonar Pro', thinker: '', quotationCount: 0,
        output: '', skeleton: '', progress: 0, status: 'idle', provider: '', ...latest.current,
      } };
    };
    window.addEventListener('neurotext-payment-handoff', collect);
    return () => window.removeEventListener('neurotext-payment-handoff', collect);
  }, [functionId]);
}
export async function prepareBillingNavigation() {
  const detail: { draft?: Handoff } = {};
  window.dispatchEvent(new CustomEvent('neurotext-payment-handoff', { detail }));
  if (!detail.draft) return;
  if (['writing', 'preparing'].includes(detail.draft.workspace.status)) {
    throw new Error('Finish or interrupt the current operation before leaving this page.');
  }
  const response = await fetch(import.meta.env.BASE_URL + 'api/billing/preserve', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Neurotext-Request': '1' },
    body: JSON.stringify(detail.draft),
  });
  if (!response.ok) throw new Error('Your work could not be preserved. Nothing has been cleared; copy it before leaving.');
  sessionStorage.setItem('neurotext-payment-function', String(detail.draft.functionId));
}
