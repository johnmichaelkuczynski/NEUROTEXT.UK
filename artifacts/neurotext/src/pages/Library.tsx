import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetAccount, useListLibrary, useCreateLibraryDocument, useDeleteLibraryDocument,
  getListLibraryQueryKey, getLibraryDocument,
} from '@workspace/api-client-react';
import type { LibraryDocumentText, LibraryDocumentInputFormat } from '@workspace/api-client-react';
import { Download, Eye, Trash2, Upload, X } from 'lucide-react';
import { readDocumentUpload, DOCUMENT_UPLOAD_ACCEPT } from '@/lib/document-upload';
import { errorMessage, downloadText, formatBytes, formatDate } from '@/lib/private-utils';

const MAX_FILE = 10 * 1024 * 1024;

function formatFor(name: string): LibraryDocumentInputFormat {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'pdf';
  if (ext === 'doc' || ext === 'docx') return 'doc';
  return 'txt';
}

export function SignedOutNotice({ what }: { what: string }) {
  return (
    <div className="max-w-xl mx-auto my-16 rounded-lg border border-border bg-card p-6 text-sm" data-testid="text-signed-out">
      <h1 className="text-lg font-bold mb-2">{what} requires an optional account</h1>
      <p className="text-muted-foreground mb-4">Generation works without signing in. Sign in with Google only if you want a private {what.toLowerCase()} that persists across sessions.</p>
      <a href={import.meta.env.BASE_URL + 'api/auth/google'} className="inline-block rounded bg-primary px-3 py-1.5 font-semibold text-primary-foreground" data-testid="link-signin">Sign in with Google</a>
    </div>
  );
}

export default function Library() {
  const queryClient = useQueryClient();
  const { data: account, isLoading: accountLoading } = useGetAccount();
  const signedIn = !!account?.user;
  const lib = useListLibrary({ query: { enabled: signedIn, queryKey: getListLibraryQueryKey() } });
  const create = useCreateLibraryDocument();
  const del = useDeleteLibraryDocument();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<LibraryDocumentText | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  if (accountLoading) return <div className="max-w-[1200px] mx-auto w-full p-8"><div className="h-40 rounded-lg bg-muted animate-pulse" /></div>;
  if (!signedIn) return <SignedOutNotice what="Library" />;

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setUploadErrors([]);
    const errs: string[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE) { errs.push(file.name + ': exceeds 10 MB per-file limit.'); continue; }
      try {
        setStatus('Extracting text from ' + file.name + '...');
        const text = await readDocumentUpload(file);
        if (!text.trim()) throw new Error('No text could be extracted.');
        setStatus('Saving ' + file.name + '...');
        await create.mutateAsync({ data: { title: file.name.slice(0, 250), text, format: formatFor(file.name), originalBytes: file.size } });
      } catch (e) {
        errs.push(file.name + ': ' + errorMessage(e, 'Upload failed.'));
      }
    }
    await queryClient.invalidateQueries({ queryKey: getListLibraryQueryKey() });
    setUploadErrors(errs); setStatus(null); setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const view = async (id: string, download = false) => {
    setRowBusy(id); setRowError(null);
    try {
      const doc = await getLibraryDocument(id);
      if (download) downloadText(doc.title, doc.text); else setViewing(doc);
    } catch (e) { setRowError(errorMessage(e, 'Could not load document.')); }
    setRowBusy(null);
  };

  const remove = (id: string) => {
    setRowError(null);
    del.mutate({ documentId: id }, {
      onSuccess: () => { if (viewing?.id === id) setViewing(null); queryClient.invalidateQueries({ queryKey: getListLibraryQueryKey() }); },
      onError: (e) => setRowError(errorMessage(e, 'Delete failed.')),
    });
  };

  const state = lib.data;
  const pagePct = state ? Math.min(100, (state.usedPages / state.maxPages) * 100) : 0;
  const bytePct = state ? Math.min(100, (state.usedBytes / state.maxBytes) * 100) : 0;

  return (
    <main className="max-w-[1200px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Private library</h1>
          <p className="text-sm text-muted-foreground max-w-2xl mt-1">Only extracted text is stored; original files are never retained. Quota counts 500 words per page. TXT and Markdown are charged 1x, DOC/DOCX 2x, PDF and images 4x. Total weighted storage is capped at 50 MiB; each file may be at most 10 MB.</p>
        </div>
        <div>
          <input ref={fileRef} type="file" multiple accept={DOCUMENT_UPLOAD_ACCEPT + ',.doc,.docx'} className="hidden" onChange={(e) => handleFiles(e.target.files)} data-testid="input-library-file" />
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-upload">
            <Upload className="h-4 w-4" /> {busy ? 'Working' : 'Upload documents'}
          </button>
        </div>
      </div>

      {state ? (
        <div className="grid gap-4 sm:grid-cols-2 rounded-lg border border-border bg-card p-4 text-xs" data-testid="text-quota">
          <div>
            <div className="flex justify-between mb-1"><span className="font-semibold">Pages</span><span className="font-mono">{state.usedPages.toLocaleString()} / {state.maxPages.toLocaleString()}</span></div>
            <div className="h-1.5 rounded bg-muted"><div className="h-full rounded bg-primary" style={{ width: pagePct + '%' }} /></div>
          </div>
          <div>
            <div className="flex justify-between mb-1"><span className="font-semibold">Weighted storage</span><span className="font-mono">{formatBytes(state.usedBytes)} / {formatBytes(state.maxBytes)}</span></div>
            <div className="h-1.5 rounded bg-muted"><div className="h-full rounded bg-primary" style={{ width: bytePct + '%' }} /></div>
          </div>
        </div>
      ) : null}

      {status ? <p className="text-sm text-muted-foreground" data-testid="status-upload">{status}</p> : null}
      {uploadErrors.length ? (
        <div className="rounded border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert" data-testid="text-upload-errors">
          {uploadErrors.map((m) => <p key={m}>{m}</p>)}
        </div>
      ) : null}
      {rowError ? <p className="text-sm text-destructive" role="alert" data-testid="text-row-error">{rowError}</p> : null}

      {lib.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 rounded bg-muted animate-pulse" />)}</div>
      ) : lib.isError ? (
        <div className="rounded border border-destructive/40 p-4 text-sm text-destructive">
          {errorMessage(lib.error, 'Could not load library.')} <button type="button" className="underline ml-2" onClick={() => lib.refetch()} data-testid="button-retry-library">Retry</button>
        </div>
      ) : !state?.documents.length ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground" data-testid="text-library-empty">
          Your library is empty. Upload source texts once and insert them into any supporting field later.
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card divide-y divide-border">
          {state.documents.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-3 p-3 text-sm" data-testid={'row-library-' + d.id}>
              <div className="flex-1 min-w-[200px]">
                <p className="font-semibold truncate">{d.title}</p>
                <p className="text-xs text-muted-foreground font-mono">{d.format.toUpperCase()} · {d.wordCount.toLocaleString()} words · {d.pages} pp · charged {d.chargedPages} pp / {formatBytes(d.chargedBytes)} · {formatDate(d.createdAt)}</p>
              </div>
              <div className="flex gap-1">
                <button type="button" disabled={rowBusy === d.id} onClick={() => view(d.id)} className="rounded p-2 hover:bg-muted" title="View" data-testid={'button-view-' + d.id}><Eye className="h-4 w-4" /></button>
                <button type="button" disabled={rowBusy === d.id} onClick={() => view(d.id, true)} className="rounded p-2 hover:bg-muted" title="Download TXT" data-testid={'button-download-' + d.id}><Download className="h-4 w-4" /></button>
                <button type="button" disabled={del.isPending && del.variables?.documentId === d.id} onClick={() => remove(d.id)} className="rounded p-2 text-destructive hover:bg-destructive/10" title="Delete" data-testid={'button-delete-' + d.id}><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewing ? (
        <section className="rounded-lg border border-border bg-card p-5" data-testid="panel-view-document">
          <div className="flex justify-between items-start gap-3 mb-4">
            <h2 className="font-bold">{viewing.title}</h2>
            <div className="flex gap-1">
              <button type="button" onClick={() => downloadText(viewing.title, viewing.text)} className="rounded p-2 hover:bg-muted" data-testid="button-download-viewing"><Download className="h-4 w-4" /></button>
              <button type="button" onClick={() => setViewing(null)} className="rounded p-2 hover:bg-muted" data-testid="button-close-viewing"><X className="h-4 w-4" /></button>
            </div>
          </div>
          <pre className="whitespace-pre-wrap font-serif text-sm leading-relaxed max-h-[70vh] overflow-auto">{viewing.text}</pre>
        </section>
      ) : null}
    </main>
  );
}
