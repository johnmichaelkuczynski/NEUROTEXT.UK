import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetAccount, useListHistory, useDeleteHistoryWork, useSaveWorkspace,
  getListHistoryQueryKey, getHistoryWork, getGetWorkspaceQueryKey,
} from '@workspace/api-client-react';
import type { HistoryWork } from '@workspace/api-client-react';
import { Download, Eye, RotateCcw, Trash2, X } from 'lucide-react';
import { MathText } from '@/components/math-text';
import { SignedOutNotice } from '@/pages/Library';
import { errorMessage, downloadText, formatDate } from '@/lib/private-utils';

export default function History() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { data: account, isLoading: accountLoading } = useGetAccount();
  const signedIn = !!account?.user;
  const list = useListHistory({ query: { enabled: signedIn, queryKey: getListHistoryQueryKey() } });
  const del = useDeleteHistoryWork();
  const save = useSaveWorkspace();
  const [viewing, setViewing] = useState<HistoryWork | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (accountLoading) return <div className="max-w-[1200px] mx-auto w-full p-8"><div className="h-40 rounded-lg bg-muted animate-pulse" /></div>;
  if (!signedIn) return <SignedOutNotice what="Past work" />;

  const load = async (id: string, mode: 'view' | 'download' | 'restore') => {
    setRowBusy(id); setError(null);
    try {
      const work = await getHistoryWork(id);
      if (mode === 'view') setViewing(work);
      else if (mode === 'download') downloadText(work.title, work.workspace.output);
      else await restore(work);
    } catch (e) { setError(errorMessage(e, 'Could not load work.')); }
    setRowBusy(null);
  };

  const restore = async (work: HistoryWork) => {
    const w = work.workspace;
    const fid = w.functionId || work.functionId;
    await save.mutateAsync({ functionId: fid, data: {
      instructions: w.instructions, instructionDraft: w.instructionDraft, sourceDocument: w.sourceDocument,
      targetWords: w.targetWords, selectedModel: w.selectedModel, thinker: w.thinker, quotationCount: w.quotationCount,
      output: w.output, generationError: w.generationError, skeleton: w.skeleton, progress: w.progress,
      status: w.status === 'writing' || w.status === 'preparing' ? 'interrupted' : w.status, provider: w.provider,
    } });
    await queryClient.invalidateQueries({ queryKey: getGetWorkspaceQueryKey(fid) });
    navigate('/');
  };

  const remove = (id: string) => {
    setError(null);
    del.mutate({ historyId: id }, {
      onSuccess: () => { if (viewing?.id === id) setViewing(null); queryClient.invalidateQueries({ queryKey: getListHistoryQueryKey() }); },
      onError: (e) => setError(errorMessage(e, 'Delete failed.')),
    });
  };

  const items = list.data ?? [];

  return (
    <main className="max-w-[1200px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Past work</h1>
        <p className="text-sm text-muted-foreground mt-1">Completed outputs saved privately to your account. Restore one to reopen it in its function workspace.</p>
      </div>
      {error ? <p className="text-sm text-destructive" role="alert" data-testid="text-history-error">{error}</p> : null}
      {list.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 rounded bg-muted animate-pulse" />)}</div>
      ) : list.isError ? (
        <div className="rounded border border-destructive/40 p-4 text-sm text-destructive">
          {errorMessage(list.error, 'Could not load past work.')} <button type="button" className="underline ml-2" onClick={() => list.refetch()} data-testid="button-retry-history">Retry</button>
        </div>
      ) : !items.length ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground" data-testid="text-history-empty">No past work yet. Completed generations will appear here.</div>
      ) : (
        <div className="rounded-lg border border-border bg-card divide-y divide-border">
          {items.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center gap-3 p-3 text-sm" data-testid={'row-history-' + h.id}>
              <div className="flex-1 min-w-[200px]">
                <p className="font-semibold truncate">{h.title}</p>
                <p className="text-xs text-muted-foreground font-mono">Function {h.functionId} · {h.wordCount.toLocaleString()} words · {formatDate(h.createdAt)}</p>
              </div>
              <div className="flex gap-1">
                <button type="button" disabled={rowBusy === h.id} onClick={() => load(h.id, 'view')} className="rounded p-2 hover:bg-muted" title="View" data-testid={'button-view-' + h.id}><Eye className="h-4 w-4" /></button>
                <button type="button" disabled={rowBusy === h.id} onClick={() => load(h.id, 'download')} className="rounded p-2 hover:bg-muted" title="Download TXT" data-testid={'button-download-' + h.id}><Download className="h-4 w-4" /></button>
                <button type="button" disabled={rowBusy === h.id} onClick={() => load(h.id, 'restore')} className="rounded p-2 hover:bg-muted" title="Restore to workspace" data-testid={'button-restore-' + h.id}><RotateCcw className="h-4 w-4" /></button>
                <button type="button" disabled={del.isPending && del.variables?.historyId === h.id} onClick={() => remove(h.id)} className="rounded p-2 text-destructive hover:bg-destructive/10" title="Delete" data-testid={'button-delete-' + h.id}><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {viewing ? (
        <section className="rounded-lg border border-border bg-card p-5" data-testid="panel-view-history">
          <div className="flex justify-between items-start gap-3 mb-4">
            <h2 className="font-bold">{viewing.title}</h2>
            <div className="flex gap-1">
              <button type="button" onClick={() => restore(viewing).catch((e) => setError(errorMessage(e, 'Restore failed.')))} className="rounded p-2 hover:bg-muted" title="Restore" data-testid="button-restore-viewing"><RotateCcw className="h-4 w-4" /></button>
              <button type="button" onClick={() => downloadText(viewing.title, viewing.workspace.output)} className="rounded p-2 hover:bg-muted" data-testid="button-download-viewing"><Download className="h-4 w-4" /></button>
              <button type="button" onClick={() => setViewing(null)} className="rounded p-2 hover:bg-muted" data-testid="button-close-viewing"><X className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="max-h-[70vh] overflow-auto whitespace-pre-wrap text-sm leading-relaxed"><MathText text={viewing.workspace.output} /></div>
        </section>
      ) : null}
    </main>
  );
}
