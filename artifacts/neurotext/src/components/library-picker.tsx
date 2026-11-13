import { useState } from 'react';
import { useGetAccount, useListLibrary, getListLibraryQueryKey, getLibraryDocument } from '@workspace/api-client-react';
import { BookOpen } from 'lucide-react';
import { errorMessage, countWords } from '@/lib/private-utils';

const MAX_WORDS = 20000;
const MAX_CHARS = 120000;

export function LibraryPicker({ onInsert, disabled, currentText = '' }: { onInsert: (text: string) => void; disabled?: boolean; currentText?: string }) {
  const { data: account } = useGetAccount();
  const signedIn = !!account?.user;
  const lib = useListLibrary({ query: { enabled: signedIn, queryKey: getListLibraryQueryKey() } });
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!signedIn) return null;

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const insert = async () => {
    setBusy(true); setError(null);
    try {
      const docs = [];
      for (const id of selected) docs.push(await getLibraryDocument(id));
      const block = docs.map((d) => '=== ' + d.title + ' ===\n\n' + d.text.trim()).join('\n\n');
      const combined = currentText.trim() ? currentText.replace(/\s+$/, '') + '\n\n' + block : block;
      const words = countWords(combined);
      if (words > MAX_WORDS || combined.length > MAX_CHARS) {
        setError('Not inserted: the field would contain ' + words.toLocaleString() + ' words / ' + combined.length.toLocaleString() + ' characters. The limit is 20,000 words or 120,000 characters (about 40 pages at 500 words per page). Select fewer documents or shorten the field. Nothing was truncated.');
      } else {
        onInsert(block);
        setSelected([]); setOpen(false);
      }
    } catch (e) { setError(errorMessage(e, 'Could not load selected documents.')); }
    setBusy(false);
  };

  const docs = lib.data?.documents ?? [];

  return (
    <div className="text-xs" data-testid="library-picker">
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 font-semibold hover:bg-muted disabled:opacity-50" data-testid="button-toggle-library-picker">
        <BookOpen className="h-3 w-3" /> From library
      </button>
      {open ? (
        <div className="mt-2 rounded-lg border border-border bg-card p-3 space-y-2">
          <p className="text-muted-foreground">Inserted text is appended. A field may hold up to 20,000 words or 120,000 characters, about 40 pages at 500 words per page.</p>
          {lib.isLoading ? <div className="h-8 rounded bg-muted animate-pulse" />
            : lib.isError ? <p className="text-destructive">{errorMessage(lib.error, 'Could not load library.')} <button type="button" className="underline" onClick={() => lib.refetch()} data-testid="button-retry-picker">Retry</button></p>
            : !docs.length ? <p className="text-muted-foreground">Your library is empty.</p>
            : (
              <div className="max-h-48 overflow-auto divide-y divide-border rounded border border-border">
                {docs.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 p-2 cursor-pointer hover:bg-muted" data-testid={'option-library-' + d.id}>
                    <input type="checkbox" checked={selected.includes(d.id)} onChange={() => toggle(d.id)} disabled={disabled || busy} />
                    <span className="flex-1 truncate">{d.title}</span>
                    <span className="font-mono text-muted-foreground">{d.wordCount.toLocaleString()} w</span>
                  </label>
                ))}
              </div>
            )}
          {error ? <p className="text-destructive" role="alert" data-testid="text-picker-error">{error}</p> : null}
          <button type="button" disabled={disabled || busy || !selected.length} onClick={insert} className="rounded bg-primary px-3 py-1 font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-insert-library">
            {busy ? 'Inserting' : 'Insert ' + (selected.length || '') + ' selected'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
