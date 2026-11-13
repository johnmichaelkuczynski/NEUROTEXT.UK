import { useEffect, useRef, useState } from 'react';
import {
  type WorkspaceInput,
  type FunctionWorkspace,
  useGetWorkspace,
  useSaveWorkspace,
  useGetAccount,
  getGetWorkspaceQueryKey,
  getListWorkspacesQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Upload, Copy, Download, Play } from 'lucide-react';
import { toast } from 'sonner';
import { MathText } from '@/components/math-text';
import { LibraryPicker } from '@/components/library-picker';
import { errorMessage, countWords, downloadText } from '@/lib/private-utils';
import { DOCUMENT_UPLOAD_ACCEPT, readDocumentUpload } from '@/lib/document-upload';
import { useFunctionStream, GenerationFailure } from '@/hooks/use-function-stream';

const FUNCTION_ID = 12;
const MAX_WORDS = 20_000;
const MAX_CHARS = 120_000;
const TARGET_WORDS = 500;
const DEFAULT_MODEL = 'ZHI 6 · Perplexity Sonar Pro';
const THINKER = 'Standard NEUROTEXT style';
const SAVE_DELAY = 1000;

type FieldKey = 'a' | 'b';
type Local = { a: string; b: string; model: string; report: string; error: string; provider: string };

const overLimit = (t: string) => countWords(t) > MAX_WORDS || t.length > MAX_CHARS;
const limitMessage = (t: string) =>
  `Not added: the field would contain ${countWords(t).toLocaleString()} words / ${t.length.toLocaleString()} characters. The limit is 20,000 words or 120,000 characters. For long drafts, use individual chapters or excerpts. Existing content was kept; nothing was truncated.`;
const appendBlock = (current: string, block: string) =>
  current.trim() ? `${current.replace(/\s+$/, '')}\n\n${block}` : block;

function toInput(s: Local): WorkspaceInput {
  return {
    instructions: '',
    instructionDraft: s.a,
    sourceDocument: s.b,
    targetWords: TARGET_WORDS,
    selectedModel: s.model,
    thinker: THINKER,
    quotationCount: 0,
    output: s.report,
    generationError: s.error,
    skeleton: '',
    progress: s.report.trim() ? 100 : 0,
    status: s.error ? 'failed' : s.report.trim() ? 'complete' : 'idle',
    provider: s.provider,
  };
}

export default function RelevancePortal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const account = useGetAccount();
  const signedIn = !!account.data?.user;
  const workspace = useGetWorkspace(FUNCTION_ID, {
    query: signedIn
      ? { enabled: true, queryKey: getGetWorkspaceQueryKey(FUNCTION_ID), refetchOnMount: false }
      : { enabled: false, queryKey: getGetWorkspaceQueryKey(FUNCTION_ID), staleTime: Infinity, refetchOnWindowFocus: false },
  });
  const saveWorkspace = useSaveWorkspace({ mutation: {
    scope: { id: 'workspace-writes' },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getListWorkspacesQueryKey() }); },
  } });
  const saveMutate = useRef(saveWorkspace.mutate);
  saveMutate.current = saveWorkspace.mutate;
  const stream = useFunctionStream();

  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [report, setReport] = useState('');
  const [error, setError] = useState('');
  const [provider, setProvider] = useState('');
  const [running, setRunning] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [fieldError, setFieldError] = useState<Record<FieldKey, string>>({ a: '', b: '' });
  const [uploading, setUploading] = useState<Record<FieldKey, string>>({ a: '', b: '' });
  const [dragging, setDragging] = useState<FieldKey | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  const initialized = useRef(false);
  const resetting = useRef(false);
  const mounted = useRef(true);
  const local = useRef<Local>({ a: '', b: '', model: DEFAULT_MODEL, report: '', error: '', provider: '' });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<WorkspaceInput | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const fileA = useRef<HTMLInputElement>(null);
  const fileB = useRef<HTMLInputElement>(null);
  const signedInRef = useRef(signedIn);
  signedInRef.current = signedIn;

  // Init once from cache/server; never overwrite local work on later refetches.
  useEffect(() => {
    if (initialized.current || account.isLoading) return;
    if (signedIn && (workspace.isLoading || workspace.isError || !workspace.data)) return;
    initialized.current = true;
    const w = workspace.data;
    if (!w) return;
    const s: Local = {
      a: w.instructionDraft || '', b: w.sourceDocument || '', model: w.selectedModel || DEFAULT_MODEL,
      report: w.output || '', error: w.generationError || '', provider: w.provider || '',
    };
    local.current = s;
    setA(s.a); setB(s.b); setModel(s.model); setReport(s.report); setError(s.error); setProvider(s.provider);
  }, [account.isLoading, signedIn, workspace.isLoading, workspace.data]);

  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const data = pending.current;
    pending.current = null;
    if (data && !resetting.current && signedInRef.current) {
      saveMutate.current({ functionId: FUNCTION_ID, data }, {
        onError: e => { if (mounted.current) setSaveError(errorMessage(e, 'Workspace was not saved. Copy or download your text before leaving.')); },
      });
    }
  };

  // Synchronously merge into the in-memory cache so navigating away and back keeps everything.
  const commit = (patch: Partial<Local>, immediate = false) => {
    if (resetting.current) return;
    const next = { ...local.current, ...patch };
    local.current = next;
    const input = toInput(next);
    void queryClient.cancelQueries({ queryKey: getGetWorkspaceQueryKey(FUNCTION_ID), exact: true }, { revert: false });
    queryClient.setQueryData<FunctionWorkspace>(getGetWorkspaceQueryKey(FUNCTION_ID), old => ({
      ...(old ?? {}), ...input, functionId: FUNCTION_ID, updatedAt: old?.updatedAt ?? new Date().toISOString(),
    } as FunctionWorkspace));
    if (!signedInRef.current) return;
    pending.current = input;
    if (timer.current) clearTimeout(timer.current);
    if (immediate) flush();
    else timer.current = setTimeout(flush, SAVE_DELAY);
  };

  useEffect(() => {
    mounted.current = true;
    const set = controllers.current;
    return () => {
      mounted.current = false;
      for (const c of set) c.abort();
      set.clear();
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setField = (key: FieldKey, value: string) => {
    if (key === 'a') { setA(value); commit({ a: value }); } else { setB(value); commit({ b: value }); }
  };
  const fieldValue = (key: FieldKey) => (key === 'a' ? local.current.a : local.current.b);

  const handleFiles = async (key: FieldKey, files: File[]) => {
    if (!files.length || uploading[key] || running || resetting.current) return;
    setFieldError(e => ({ ...e, [key]: '' }));
    const controller = new AbortController();
    controllers.current.add(controller);
    let current = fieldValue(key);
    try {
      for (const file of files) {
        setUploading(u => ({ ...u, [key]: `Reading ${file.name}...` }));
        const text = (await readDocumentUpload(file, controller.signal)).trim();
        if (controller.signal.aborted) return;
        if (!text) throw new Error(`${file.name} contained no readable text.`);
        const next = appendBlock(current, `=== ${file.name} ===\n\n${text}`);
        if (overLimit(next)) { setFieldError(e => ({ ...e, [key]: `${file.name}: ${limitMessage(next)}` })); return; }
        current = next;
        setField(key, current);
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      setFieldError(er => ({ ...er, [key]: errorMessage(e, 'Could not read this file.') }));
    } finally {
      controllers.current.delete(controller);
      if (mounted.current && !controller.signal.aborted) setUploading(u => ({ ...u, [key]: '' }));
    }
  };

  const insertLibrary = (key: FieldKey, block: string) => {
    const next = appendBlock(fieldValue(key), block);
    if (overLimit(next)) { setFieldError(e => ({ ...e, [key]: limitMessage(next) })); return; }
    setFieldError(e => ({ ...e, [key]: '' }));
    setField(key, next);
  };

  const aOver = overLimit(a);
  const bOver = overLimit(b);
  const busyUpload = !!uploading.a || !!uploading.b;
  const canRun = !!a.trim() && !!b.trim() && !aOver && !bOver && !running && !busyUpload && !isResetting;

  const handleRun = async () => {
    if (!canRun) return;
    flush();
    setRunning(true);
    setError('');
    try {
      const text = await stream.startStream({
        functionId: FUNCTION_ID,
        instructions: '',
        instructionDraft: local.current.a,
        sourceDocument: local.current.b,
        targetWords: TARGET_WORDS,
        selectedModel: local.current.model,
        thinker: THINKER,
        quotationCount: 0,
      });
      if (!mounted.current || resetting.current) return;
      setReport(text); setProvider(local.current.model); setError('');
      commit({ report: text, error: '', provider: local.current.model }, true);
    } catch (e) {
      if (!mounted.current || resetting.current) return;
      const msg = e instanceof GenerationFailure ? e.message : errorMessage(e, 'Relevance assessment failed.');
      setError(msg);
      commit({ error: msg }, true);
    } finally {
      if (mounted.current) setRunning(false);
    }
  };

  const handleClear = async () => {
    if (resetting.current) return;
    resetting.current = true;
    setIsResetting(true);
    if (timer.current) clearTimeout(timer.current);
    pending.current = null;
    for (const c of controllers.current) c.abort();
    controllers.current.clear();
    stream.interrupt();
    if (!signedIn) { queryClient.removeQueries({ queryKey: getGetWorkspaceQueryKey(FUNCTION_ID) }); window.location.reload(); return; }
    try {
      await saveWorkspace.mutateAsync({ functionId: FUNCTION_ID, data: toInput({ a: '', b: '', model: DEFAULT_MODEL, report: '', error: '', provider: '' }) });
      window.location.reload();
    } catch (e) {
      resetting.current = false;
      setIsResetting(false);
      setUploading({ a: '', b: '' });
      setSaveError(errorMessage(e, 'Could not clear the saved workspace. Nothing was cleared; please try again.'));
    }
  };

  const handleClose = () => { flush(); onClose(); };

  const shown = running ? stream.output : report;
  const handleCopy = async () => {
    if (!shown) return;
    try { await navigator.clipboard.writeText(shown); toast.success('Copied to clipboard'); }
    catch { setError('Could not copy. Select the text and copy it manually.'); }
  };

  if (account.isLoading || (signedIn && workspace.isLoading && !initialized.current)) {
    return (
      <Card className="p-8 border border-border/50 shadow-sm space-y-4" data-testid="card-relevance-loading">
        <div className="h-4 w-40 rounded bg-muted animate-pulse" />
        <div className="h-8 w-72 rounded bg-muted animate-pulse" />
        <div className="grid md:grid-cols-2 gap-6"><div className="h-56 rounded-lg bg-muted animate-pulse" /><div className="h-56 rounded-lg bg-muted animate-pulse" /></div>
      </Card>
    );
  }
  if (signedIn && workspace.isError && !initialized.current) {
    return <Card className="p-8 space-y-3" data-testid="error-relevance-load">
      <p role="alert">{errorMessage(workspace.error, 'Could not load your saved workspace. Editing is paused to protect your existing work.')}</p>
      <Button onClick={() => void workspace.refetch()}>Retry loading saved work</Button>
      <Button variant="ghost" onClick={onClose}>Close Workspace</Button>
    </Card>;
  }

  const renderField = (key: FieldKey, step: string, title: string, help: string, placeholder: string) => {
    const value = key === 'a' ? a : b;
    const over = key === 'a' ? aOver : bOver;
    const input = key === 'a' ? fileA : fileB;
    const words = countWords(value);
    return (
      <section className="min-w-0" data-testid={`field-relevance-${key}`}>
        <div className="mb-3">
          <div className="text-[11px] font-bold text-primary tracking-widest uppercase mb-1">{step}</div>
          <Label htmlFor={`relevance-${key}`} className="font-bold text-foreground text-sm">{title}</Label>
          <p className="text-xs text-muted-foreground mt-1">{help}</p>
        </div>
        <div
          onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(key); } }}
          onDragLeave={() => setDragging(null)}
          onDrop={e => {
            setDragging(null);
            const files = Array.from(e.dataTransfer.files);
            if (!files.length) return; // plain text drops fall through to the native textarea
            e.preventDefault();
            void handleFiles(key, files);
          }}
          className={`rounded-lg transition-colors ${dragging === key ? 'ring-2 ring-primary bg-primary/5' : ''}`}
        >
          <Textarea
            id={`relevance-${key}`}
            value={value}
            readOnly={running || !!uploading[key] || isResetting}
            onChange={e => setField(key, e.target.value)}
            placeholder={placeholder}
            className="min-h-[260px] text-sm resize-y"
            data-testid={`textarea-relevance-${key}`}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 mt-2 px-1">
          <span className={`text-xs font-medium ${over ? 'text-destructive' : 'text-muted-foreground'}`} data-testid={`text-relevance-count-${key}`}>
            {words.toLocaleString()} / 20,000 words · {value.length.toLocaleString()} / 120,000 characters
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={running || !!uploading[key] || isResetting} onClick={() => input.current?.click()}
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-semibold hover:bg-muted disabled:opacity-50" data-testid={`button-relevance-upload-${key}`}>
              {uploading[key] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} Upload
            </button>
            <LibraryPicker disabled={running || !!uploading[key] || isResetting} currentText={value} onInsert={block => insertLibrary(key, block)} />
          </div>
        </div>
        <input ref={input} type="file" multiple className="hidden" accept={DOCUMENT_UPLOAD_ACCEPT} aria-label={`Upload files to ${title}`}
          data-testid={`input-relevance-file-${key}`}
          onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ''; void handleFiles(key, files); }} />
        {uploading[key] && <p className="text-xs text-muted-foreground mt-2" data-testid={`status-relevance-upload-${key}`}>{uploading[key]}</p>}
        {over && !fieldError[key] && <p className="text-xs text-destructive mt-2" data-testid={`error-relevance-limit-${key}`}>This field exceeds 20,000 words or 120,000 characters. For long drafts, use individual chapters or excerpts.</p>}
        {fieldError[key] && <p className="text-xs text-destructive mt-2" role="alert" data-testid={`error-relevance-field-${key}`}>{fieldError[key]}</p>}
      </section>
    );
  };

  const statusText = stream.status === 'preparing'
    ? 'Preparing: reading both documents and verifying quotations against the materials...'
    : stream.status === 'writing' ? 'Writing the report...' : 'Working...';

  return (
    <Card className="border border-border/60 shadow-lg bg-card overflow-hidden" data-testid="card-relevance">
      <div className="p-6 md:p-8">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8">
          <div>
            <div className="text-[11px] font-bold text-primary tracking-widest uppercase mb-2">Function 12</div>
            <h3 className="text-2xl font-bold text-foreground">Relevance Assessment</h3>
            <p className="text-muted-foreground mt-2 text-sm max-w-2xl">
              Judge whether a body of material bears on the work you are writing. Both boxes are treated as content, not instructions. The result is a short report with a verdict, a summary and the relevant points, each backed by verbatim quotations.
            </p>
          </div>
          <div className="flex gap-2 self-start shrink-0">
            <Button variant="ghost" onClick={() => void handleClear()} disabled={isResetting} className="text-muted-foreground h-8 text-xs font-semibold" data-testid="button-relevance-clear">
              {isResetting && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}Clear
            </Button>
            <Button variant="ghost" onClick={handleClose} className="text-muted-foreground h-8 text-xs font-semibold" data-testid="button-relevance-close">
              Close Workspace
            </Button>
          </div>
        </div>

        <div className="space-y-8">
          <div className="grid md:grid-cols-2 gap-8">
            {renderField('a', 'Box A • Current draft', 'Your current draft',
              'Essay, thesis, dissertation, homework or any work in progress. Type, paste, drop files or upload.',
              'Paste or type your draft here, or drop files...')}
            {renderField('b', 'Box B • Materials', 'Materials to assess',
              'Sources whose relevance to your draft should be judged. Multiple files keep their file labels.',
              'Paste the materials here, or drop files...')}
          </div>

          <div className="flex flex-col md:flex-row md:items-end gap-4">
            <div className="space-y-2 md:w-80">
              <Label className="text-xs font-bold text-foreground block">Choose LLM</Label>
              <Select value={model} disabled={running} onValueChange={v => { setModel(v); commit({ model: v }); }}>
                <SelectTrigger className="w-full text-sm" data-testid="select-relevance-model"><SelectValue placeholder="Select LLM" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ZHI 6 · Perplexity Sonar Pro">ZHI 6 · Perplexity Sonar Pro</SelectItem>
                  <SelectItem value="ZHI 1 · OpenAI GPT-5.6 Terra">ZHI 1 · OpenAI</SelectItem>
                  <SelectItem value="ZHI 2 · Anthropic Claude Sonnet 5">ZHI 2 · Anthropic Claude</SelectItem>
                  <SelectItem value="ZHI 3 · xAI Grok 4.6">ZHI 3 · xAI Grok</SelectItem>
                  <SelectItem value="ZHI 4 · DeepSeek V4 Pro">ZHI 4 · DeepSeek</SelectItem>
                  <SelectItem value="ZHI 5 · Venice AI">ZHI 5 · Venice AI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => void handleRun()} disabled={!canRun} className="h-10 px-6 text-sm font-semibold" data-testid="button-relevance-run">
              {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
              {running ? 'Assessing...' : 'Assess relevance'}
            </Button>
            <p className="text-xs text-muted-foreground md:pb-2">Brief report, about 500 words.{!signedIn && ' Sign in to keep this work; otherwise it is lost on reload.'}</p>
          </div>

          {running && <p className="text-xs text-muted-foreground" data-testid="status-relevance-stream">{statusText}</p>}
          {error && <p className="text-xs text-destructive" role="alert" data-testid="error-relevance-run">{error}</p>}
          {saveError && <p className="text-xs text-destructive" role="alert" data-testid="error-relevance-save">{saveError}</p>}

          <section className="rounded-xl border border-border p-5 md:p-6" data-testid="result-relevance">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div className="text-[11px] font-bold text-primary tracking-widest uppercase">Report</div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-8 text-xs" disabled={!shown} onClick={() => void handleCopy()} data-testid="button-relevance-copy">
                  <Copy className="w-3 h-3 mr-2" />Copy
                </Button>
                <Button variant="outline" size="sm" className="h-8 text-xs" disabled={!shown} onClick={() => downloadText('relevance-assessment', shown)} data-testid="button-relevance-download">
                  <Download className="w-3 h-3 mr-2" />Download
                </Button>
              </div>
            </div>
            {shown ? (
              <div className="text-sm whitespace-pre-wrap break-words leading-relaxed" data-testid="text-relevance-report"><MathText text={shown} /></div>
            ) : running ? (
              <div className="space-y-2" data-testid="skeleton-relevance-report">
                <div className="h-3 w-1/3 rounded bg-muted animate-pulse" />
                <div className="h-3 w-full rounded bg-muted animate-pulse" />
                <div className="h-3 w-5/6 rounded bg-muted animate-pulse" />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="text-relevance-empty">Fill both boxes and run the assessment. The report appears here.</p>
            )}
            {provider && !running && report && <p className="text-[11px] text-muted-foreground mt-4" data-testid="text-relevance-provider">{provider}</p>}
          </section>
        </div>
      </div>
    </Card>
  );
}
