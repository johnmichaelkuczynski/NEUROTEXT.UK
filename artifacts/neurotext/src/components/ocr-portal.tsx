import { useState, useEffect, useRef } from 'react';
import {
  type WorkspaceInput,
  type FunctionWorkspace,
  useGetWorkspace,
  useSaveWorkspace,
  useCreateLibraryDocument,
  useTransferDocument,
  useGetAccount,
  getGetWorkspaceQueryKey,
  getListWorkspacesQueryKey,
  getListLibraryQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useDebounceCallback } from '@/hooks/use-debounce';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Upload, Copy, Download, ArrowRight, BookmarkPlus } from 'lucide-react';
import { toast } from 'sonner';
import { MathText } from '@/components/math-text';
import { errorMessage, countWords, downloadText } from '@/lib/private-utils';
import { OCR_UPLOAD_ACCEPT, extractOcrUpload, type OcrMode } from '@/lib/ocr-upload';
import { mergeOcrDestination } from '@/lib/ocr-state';

const FUNCTION_ID = 11;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TRANSFER_WORDS = 20_000;
const MAX_TRANSFER_CHARS = 120_000;
const DESTINATIONS: [number, string][] = [
  [1, 'Document Creator & Manipulator'], [2, 'Objections & Bullet-Proof Rewrite'], [3, 'Screenplay Generator'],
  [4, 'Dialogue Generation'], [5, 'Coherence Evaluator'], [6, 'Maximum Intelligence Rewriter'],
  [7, 'Cognitive Profiling'], [8, "Master's Thesis Creator"], [9, 'Dissertation Creator'], [10, 'Homework'],
];

interface OcrPortalProps {
  onClose: () => void;
  onUse: (id: number) => void;
}

type Snapshot = { text: string; title: string; hint: string; mode: OcrMode };

function utf8Bytes(text: string) {
  return new TextEncoder().encode(text).length;
}

export default function OcrPortal({ onClose, onUse }: OcrPortalProps) {
  const queryClient = useQueryClient();
  const account = useGetAccount();
  const signedIn = !!account.data?.user;
  const { data: serverWorkspace, isLoading: workspaceLoading } = useGetWorkspace(FUNCTION_ID, {
    query: { enabled: signedIn, queryKey: getGetWorkspaceQueryKey(FUNCTION_ID) },
  });
  const saveWorkspace = useSaveWorkspace({ mutation: {
    scope: { id: 'workspace-writes' },
    onError: e => setError(errorMessage(e, 'Workspace was not saved. Copy or download your text before leaving.')),
    onSuccess: workspace => {
      queryClient.setQueryData(getGetWorkspaceQueryKey(workspace.functionId), workspace);
      void queryClient.invalidateQueries({ queryKey: getListWorkspacesQueryKey() });
    },
  } });
  const createLibrary = useCreateLibraryDocument();
  const transferDoc = useTransferDocument();

  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [hint, setHint] = useState('');
  const [mode, setMode] = useState<OcrMode>('mathpix');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [provider, setProvider] = useState('');
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [showPreview, setShowPreview] = useState(true);
  const [destination, setDestination] = useState('');
  const [libraryError, setLibraryError] = useState('');
  const [savedToLibrary, setSavedToLibrary] = useState(false);
  const [transferError, setTransferError] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  const initialized = useRef(false);
  const lastSaved = useRef<Snapshot>({ text: '', title: '', hint: '', mode: 'mathpix' });
  const resetting = useRef(false);
  const originalBytes = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  const fileInput = useRef<HTMLInputElement>(null);
  const previewRef = useRef('');
  const stateRef = useRef({ warnings, provider, error });
  stateRef.current = { warnings, provider, error };
  const contentRef = useRef({ text, title });
  contentRef.current = { text, title };

  // Init once: signed-in users from workspace 11, anonymous users start blank.
  useEffect(() => {
    if (initialized.current || account.isLoading) return;
    if (signedIn && workspaceLoading) return;
    initialized.current = true;
    if (signedIn && serverWorkspace) {
      const snap: Snapshot = {
        text: serverWorkspace.output || '',
        title: serverWorkspace.sourceDocument || '',
        hint: serverWorkspace.instructions || '',
        mode: serverWorkspace.selectedModel === 'specialist' ? 'specialist' : 'mathpix',
      };
      setText(snap.text); setTitle(snap.title); setHint(snap.hint); setMode(snap.mode);
      setWarnings(serverWorkspace.skeleton ? serverWorkspace.skeleton.split('\n').filter(Boolean) : []);
      setProvider(serverWorkspace.provider || '');
      setError(serverWorkspace.generationError || '');
      lastSaved.current = snap;
    }
  }, [account.isLoading, signedIn, workspaceLoading, serverWorkspace]);

  useEffect(() => () => {
    for (const c of controllers.current) c.abort();
    controllers.current.clear();
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  const buildInput = (snap: Snapshot, extra?: Partial<WorkspaceInput>): WorkspaceInput => ({
    instructions: snap.hint,
    instructionDraft: '',
    sourceDocument: snap.title,
    targetWords: 100,
    selectedModel: snap.mode,
    thinker: '',
    quotationCount: 0,
    output: snap.text,
    generationError: stateRef.current.error,
    skeleton: stateRef.current.warnings.join('\n'),
    progress: snap.text.trim() ? 100 : 0,
    status: snap.text.trim() ? 'complete' : 'idle',
    provider: stateRef.current.provider,
    ...extra,
  });

  const debouncedSave = useDebounceCallback((data: WorkspaceInput) => {
    if (resetting.current) return;
    saveWorkspace.mutate({ functionId: FUNCTION_ID, data });
  }, 1000);

  useEffect(() => {
    if (!signedIn || !initialized.current || resetting.current) return;
    const snap = { text, title, hint, mode };
    const prev = lastSaved.current;
    if (snap.text === prev.text && snap.title === prev.title && snap.hint === prev.hint && snap.mode === prev.mode) return;
    lastSaved.current = snap;
    debouncedSave(buildInput(snap));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, title, hint, mode, signedIn, debouncedSave]);

  const saveNow = (snap: Snapshot, extra: Partial<WorkspaceInput>) => {
    if (!signedIn || resetting.current) return;
    debouncedSave.cancel();
    lastSaved.current = snap;
    saveWorkspace.mutate({ functionId: FUNCTION_ID, data: buildInput(snap, extra) }, {
      onError: e => setError(errorMessage(e, 'Could not save this workspace. Copy or download the text before leaving.')),
    });
  };

  const setPreview = (file: File) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = file.type.startsWith('image/') ? URL.createObjectURL(file) : '';
    previewRef.current = url;
    setPreviewUrl(url);
  };

  const handleFiles = async (files: File[]) => {
    if (!files.length || busy || controllers.current.size || resetting.current) return;
    setError('');
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) { setError(`${file.name} is larger than 10 MB. Nothing was uploaded.`); return; }
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      if (!isPdf && !file.type.startsWith('image/')) { setError(`${file.name} is not an image or PDF.`); return; }
      if (isPdf && mode === 'specialist') { setError('Specialist-script mode reads images only. Choose Mathpix to read PDFs.'); return; }
    }
    const controller = new AbortController();
    controllers.current.add(controller);
    setBusy(true);
    setSavedToLibrary(false);
    let current = text;
    let currentTitle = title;
    let collected = [...warnings];
    let lastProvider = provider;
    try {
      for (const file of files) {
        setPreview(file);
        setStatusMessage(`Reading ${file.name}...`);
        const result = await extractOcrUpload(file, mode, hint, controller.signal, setStatusMessage);
        if (controller.signal.aborted) return;
        current = [current, result.text].filter(s => s.trim()).join('\n\n');
        if (!currentTitle.trim()) currentTitle = file.name.replace(/\.[^.]+$/, '');
        collected = [...collected, ...result.warnings];
        lastProvider = result.provider;
        originalBytes.current += file.size;
        setText(current); setTitle(currentTitle); setWarnings(collected); setProvider(lastProvider);
      }
      stateRef.current = { warnings: collected, provider: lastProvider, error: '' };
      setStatusMessage(current.trim() ? 'Draft transcription ready. Review it against the original.' : 'No text was found.');
      saveNow({ text: current, title: currentTitle, hint, mode }, {
        generationError: '', skeleton: collected.join('\n'), provider: lastProvider,
      });
    } catch (e) {
      if (controller.signal.aborted) return;
      const message = errorMessage(e, 'Could not read this file.');
      setError(message);
      setStatusMessage('');
      stateRef.current = { warnings: collected, provider: lastProvider, error: message };
      saveNow({ text: current, title: currentTitle, hint, mode }, {
        generationError: message, status: current.trim() ? 'failed' : 'idle', progress: 0,
      });
    } finally {
      controllers.current.delete(controller);
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const handleFilesRef = useRef(handleFiles);
  handleFilesRef.current = handleFiles;
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files || []).filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
      if (!files.length) return;
      event.preventDefault();
      void handleFilesRef.current(files.map((f, i) => f.name && f.name !== 'image.png'
        ? f : new File([f], `screenshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}${i ? `-${i}` : ''}.png`, { type: f.type })));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const wordCount = countWords(text);
  const overTransfer = wordCount > MAX_TRANSFER_WORDS || text.length > MAX_TRANSFER_CHARS;

  const handleCopy = async () => {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); toast.success('Copied to clipboard'); }
    catch { setError('Could not copy. Select the text and copy it manually.'); }
  };

  const handleLibrary = () => {
    if (!signedIn || !text.trim()) return;
    setLibraryError('');
    const savedText = text;
    const savedTitle = title;
    createLibrary.mutate({ data: {
      title: (title.trim() || 'OCR transcription').slice(0, 250),
      text,
      format: 'pdf',
      originalBytes: Math.min(originalBytes.current || utf8Bytes(text), MAX_FILE_BYTES),
    } }, {
      onSuccess: () => {
        setSavedToLibrary(contentRef.current.text === savedText && contentRef.current.title === savedTitle);
        void queryClient.invalidateQueries({ queryKey: getListLibraryQueryKey() });
      },
      onError: e => setLibraryError(errorMessage(e, 'Could not save to your library.')),
    });
  };

  const handleTransfer = () => {
    const id = parseInt(destination, 10);
    if (isNaN(id) || !text.trim()) return;
    if (overTransfer) {
      setTransferError('Use no more than 20,000 words or 120,000 characters of source material at a time (about 40 pages). Choose relevant excerpts. Nothing has been truncated.');
      return;
    }
    setTransferError('');
    // Guest work lives only in React Query memory, not on the server.
    const guestDestination = !signedIn ? queryClient.getQueryData<FunctionWorkspace>(getGetWorkspaceQueryKey(id)) : undefined;
    const document = guestDestination?.sourceDocument.trim()
      ? `${guestDestination.sourceDocument.trimEnd()}\n\n${text}`
      : text;
    if (countWords(document) > MAX_TRANSFER_WORDS || document.length > MAX_TRANSFER_CHARS) {
      setTransferError('The destination already has supporting material. Together with this OCR text it would exceed 20,000 words or 120,000 characters. Shorten the materials first; nothing has been replaced or truncated.');
      return;
    }
    transferDoc.mutate({ data: { sourceFunctionId: FUNCTION_ID, destinationFunctionId: id, document } }, {
      onSuccess: async result => {
        queryClient.setQueryData(getGetWorkspaceQueryKey(id), mergeOcrDestination(result.destination, guestDestination));
        await queryClient.invalidateQueries({ queryKey: getListWorkspacesQueryKey() });
        onUse(id);
      },
      onError: e => setTransferError(errorMessage(e, 'Could not transfer the text.')),
    });
  };

  const handleClear = async () => {
    if (resetting.current) return;
    resetting.current = true;
    setIsResetting(true);
    debouncedSave.cancel();
    for (const c of controllers.current) c.abort();
    controllers.current.clear();
    if (!signedIn) { window.location.reload(); return; }
    try {
      await saveWorkspace.mutateAsync({ functionId: FUNCTION_ID, data: {
        instructions: '', instructionDraft: '', sourceDocument: '', targetWords: 100, selectedModel: 'mathpix',
        thinker: '', quotationCount: 0, output: '', generationError: '', skeleton: '', progress: 0, status: 'idle', provider: '',
      } });
      window.location.reload();
    } catch (e) {
      resetting.current = false;
      setIsResetting(false);
      setBusy(false);
      setError(errorMessage(e, 'Could not clear the saved workspace. Nothing was cleared; please try again.'));
    }
  };

  if (account.isLoading || (signedIn && workspaceLoading)) {
    return (
      <Card className="p-12 flex justify-center border border-border/50 shadow-sm">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </Card>
    );
  }

  return (
    <Card className="border border-border/60 shadow-lg bg-card overflow-hidden" data-testid="portal-ocr">
      <div className="p-6 md:p-8">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8">
          <div>
            <div className="text-[11px] font-bold text-primary tracking-widest uppercase mb-2">Function 11</div>
            <h3 className="text-2xl font-bold text-foreground">OCR & Transcription</h3>
            <p className="text-muted-foreground mt-2 text-sm max-w-2xl">
              Turn photographs, screenshots, handwriting and PDFs into editable text, including LaTeX mathematics, then send it as source material to any other function.
            </p>
          </div>
          <div className="flex gap-2 self-start shrink-0">
            <Button variant="ghost" onClick={() => void handleClear()} disabled={isResetting} className="text-muted-foreground h-8 text-xs font-semibold" data-testid="button-ocr-clear">
              {isResetting && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}Clear
            </Button>
            <Button variant="ghost" onClick={onClose} className="text-muted-foreground h-8 text-xs font-semibold" data-testid="button-ocr-close">
              Close Workspace
            </Button>
          </div>
        </div>

        <fieldset disabled={isResetting} className="grid min-w-0 lg:grid-cols-[1fr_300px] gap-8">
          <div className="space-y-8 min-w-0">
            <section>
              <div className="mb-3">
                <div className="text-[11px] font-bold text-primary tracking-widest uppercase mb-1">Step 1 • Reader</div>
                <h4 className="font-bold text-foreground text-sm">Choose how the image should be read</h4>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Mode</Label>
                  <Select value={mode} disabled={busy} onValueChange={v => { setMode(v as OcrMode); setError(''); }}>
                    <SelectTrigger className="h-9 text-sm" data-testid="select-ocr-mode"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mathpix">Mathpix · text, handwriting, equations, PDFs</SelectItem>
                      <SelectItem value="specialist">Specialist scripts · images only (OpenAI vision)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ocr-hint" className="text-xs font-semibold">Context (optional)</Label>
                  <Input id="ocr-hint" value={hint} disabled={busy || mode !== 'specialist'} onChange={e => setHint(e.target.value.slice(0, 2000))}
                    placeholder="e.g. Middle Egyptian hieroglyphs; Linear algebra notes" className="h-9 text-sm" data-testid="input-ocr-hint" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                {mode === 'mathpix'
                  ? 'Images and PDFs are sent to Mathpix for recognition.'
                  : 'Images are sent to OpenAI vision for a best-effort transcription of specialised scripts such as hieroglyphs. This is not a guaranteed script decoder. PDFs are not supported in this mode; choose Mathpix for PDFs.'}
                {' '}Optional context is used only in specialist mode and describes the script or notation; it is not a request to translate. No automatic translation is performed.
              </p>
            </section>

            <section>
              <div className="mb-3">
                <div className="text-[11px] font-bold text-primary tracking-widest uppercase mb-1">Step 2 • Upload</div>
                <h4 className="font-bold text-foreground text-sm">Upload, drop or paste a screenshot</h4>
              </div>
              <div
                role="button"
                tabIndex={0}
                data-testid="dropzone-ocr"
                onClick={() => !busy && fileInput.current?.click()}
                onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !busy) fileInput.current?.click(); }}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); void handleFiles(Array.from(e.dataTransfer.files)); }}
                className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer ${dragging ? 'border-primary bg-primary/5' : 'border-border bg-slate-50/50 hover:border-primary/50'}`}
              >
                {busy ? <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin text-primary" /> : <Upload className="w-6 h-6 mx-auto mb-2 text-primary" />}
                <p className="text-sm font-semibold text-foreground">{busy ? 'Reading...' : 'Click to choose files, drag them here, or paste a screenshot'}</p>
                <p className="text-xs text-muted-foreground mt-1">Images or PDF, up to 10 MB per file. Multiple files are read in order and appended.</p>
              </div>
              <input ref={fileInput} type="file" className="hidden" accept={OCR_UPLOAD_ACCEPT} multiple aria-label="Upload images or PDF"
                data-testid="input-ocr-file"
                onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ''; void handleFiles(files); }} />
              {statusMessage && !error && <p className="text-xs text-muted-foreground mt-3" data-testid="status-ocr">{statusMessage}</p>}
              {error && <p className="text-xs text-destructive mt-3" role="alert" data-testid="error-ocr">{error}</p>}
              {previewUrl && (
                <div className="mt-4">
                  <button type="button" className="text-xs font-semibold text-primary mb-2" onClick={() => setShowPreview(s => !s)} data-testid="button-ocr-toggle-preview">
                    {showPreview ? 'Hide original' : 'Show original'}
                  </button>
                  {showPreview && <img src={previewUrl} alt="Original upload for comparison" className="max-h-80 rounded-lg border border-border object-contain bg-white" data-testid="img-ocr-original" />}
                  <p className="text-[11px] text-muted-foreground mt-1">The original is shown only in this session and is not stored.</p>
                </div>
              )}
            </section>

            <section>
              <div className="mb-3">
                <div className="text-[11px] font-bold text-primary tracking-widest uppercase mb-1">Step 3 • Review</div>
                <h4 className="font-bold text-foreground text-sm">Draft transcription</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Every result is a draft. Check it against the original. <span className="font-mono">[uncertain]</span> marks material that could not be read. LaTeX remains editable and copyable.
                </p>
              </div>
              <div className="mb-3 space-y-1">
                <Label htmlFor="ocr-title" className="text-xs font-semibold">Title</Label>
                <Input id="ocr-title" value={title} disabled={busy} onChange={e => { setTitle(e.target.value.slice(0, 250)); setSavedToLibrary(false); }} placeholder="Defaults to the file name" className="h-9 text-sm" data-testid="input-ocr-title" />
              </div>
              <Textarea value={text} readOnly={busy} onChange={e => { setText(e.target.value); setSavedToLibrary(false); }}
                aria-label="Extracted text" className="min-h-[280px] text-sm resize-y font-mono" placeholder="Extracted text appears here. You can also edit or paste text directly."
                data-testid="textarea-ocr-output" />
              <div className="flex flex-wrap items-center justify-between gap-2 mt-3 px-1">
                <span className="text-xs font-medium text-muted-foreground" data-testid="text-ocr-count">
                  {wordCount.toLocaleString()} words · {text.length.toLocaleString()} characters{provider ? ` · ${provider}` : ''}
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="h-8 text-xs" disabled={!text} onClick={() => void handleCopy()} data-testid="button-ocr-copy">
                    <Copy className="w-3 h-3 mr-2" />Copy
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 text-xs" disabled={!text} onClick={() => downloadText(title || 'ocr-transcription', text)} data-testid="button-ocr-download">
                    <Download className="w-3 h-3 mr-2" />Download
                  </Button>
                </div>
              </div>
              {warnings.length > 0 && (
                <ul className="mt-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900" data-testid="list-ocr-warnings">
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
              {text.trim() && (
                <details className="mt-4 rounded-lg border border-border p-4">
                  <summary className="text-xs font-semibold text-primary cursor-pointer">Mathematical preview</summary>
                  <div className="mt-3 text-sm whitespace-pre-wrap break-words leading-relaxed" data-testid="text-ocr-math-preview"><MathText text={text} /></div>
                </details>
              )}
            </section>
          </div>

          <aside className="space-y-6">
            <div className="rounded-xl border border-border p-5 space-y-3">
              <div className="text-[11px] font-bold text-primary tracking-widest uppercase">Use as source material</div>
              <Select value={destination} onValueChange={setDestination}>
                <SelectTrigger className="h-9 text-sm" data-testid="select-ocr-destination"><SelectValue placeholder="Choose a function" /></SelectTrigger>
                <SelectContent>
                  {DESTINATIONS.map(([id, label]) => <SelectItem key={id} value={String(id)}>{id}. {label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button className="w-full h-9 text-xs font-semibold" disabled={!destination || !text.trim() || transferDoc.isPending || busy} onClick={handleTransfer} data-testid="button-ocr-transfer">
                {transferDoc.isPending ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <ArrowRight className="w-3 h-3 mr-2" />}Send and open
              </Button>
              {overTransfer && !transferError && <p className="text-xs text-muted-foreground">Over the 20,000-word / 120,000-character transfer limit. Edit down to relevant excerpts first.</p>}
              {transferError && <p className="text-xs text-destructive" role="alert" data-testid="error-ocr-transfer">{transferError}</p>}
            </div>

            <div className="rounded-xl border border-border p-5 space-y-3">
              <div className="text-[11px] font-bold text-primary tracking-widest uppercase">Private library</div>
              {signedIn ? (
                <>
                  <Button variant="outline" className="w-full h-9 text-xs font-semibold" disabled={!text.trim() || createLibrary.isPending || savedToLibrary || busy} onClick={handleLibrary} data-testid="button-ocr-library">
                    {createLibrary.isPending ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <BookmarkPlus className="w-3 h-3 mr-2" />}
                    {savedToLibrary ? 'Saved' : 'Save to library'}
                  </Button>
                  <p className="text-xs text-muted-foreground">OCR results are counted as PDF material in your library quota. This workspace is saved automatically and appears in past work.</p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Sign in to save transcriptions to your library and keep this workspace. Without signing in, this work is lost on reload; reading files does not require an account.</p>
              )}
              {libraryError && <p className="text-xs text-destructive" role="alert" data-testid="error-ocr-library">{libraryError}</p>}
            </div>
          </aside>
        </fieldset>
      </div>
    </Card>
  );
}
