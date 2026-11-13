import { useState, useEffect, useRef } from 'react';
import { 
  type FunctionWorkspace, 
  useGetWorkspace, 
  useSaveWorkspace,
  useTransferDocument,
  getGetWorkspaceQueryKey,
  getListWorkspacesQueryKey
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { GenerationFailure, useFunctionStream } from '@/hooks/use-function-stream';
import { useDebounceCallback } from '@/hooks/use-debounce';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Play, Square, FileText, Download, Copy, Upload, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { appendDraft, DEFAULT_DISSERTATION_TASK } from '@/lib/instruction-upload';
import { DOCUMENT_UPLOAD_ACCEPT, readDocumentUpload } from '@/lib/document-upload';
import { normalizeAcademicContents } from '@/lib/academic-formatting';
import { MathText } from '@/components/math-text';
import { AcademicDocument } from '@/components/academic-document';
import { LibraryPicker } from '@/components/library-picker';

const FUNCTION_LABELS: Record<number, string> = {
  1: 'Document Creator & Manipulator',
  2: 'Objections & Bullet-Proof Rewrite',
  3: 'Screenplay Generator',
  4: 'Dialogue Generation',
  5: 'Coherence Evaluator',
  6: 'Maximum Intelligence Rewriter',
  7: 'Cognitive Profiling',
  8: "Master's Thesis Creator",
  9: 'Dissertation Creator',
  10: 'Homework',
};

const FUNCTION_MIN_WORDS: Record<number, number> = {
  1: 4000,
  2: 6500,
  3: 4000,
  4: 4000,
  5: 4000,
  6: 8000,
  7: 4000,
  8: 20000,
  9: 45000,
  10: 100,
};

const DEFAULT_INSTRUCTION = "Turn the source material into a rigorous 5,000-word scholarly essay, replete with relevant legitimate scholarly studies and evidence. Include supported APA-style in-text citations and a complete APA 7 References bibliography. Do not invent sources, quotations, findings, authors, titles, dates, or publication details.";
const DEFAULT_MODEL = 'ZHI 6 · Perplexity Sonar Pro';
const LEGACY_DEFAULT_MODEL = 'ZHI 1 · OpenAI GPT-5.6 Terra';

function workspaceModel(workspace: FunctionWorkspace) {
  const isUntouchedLegacyDefault =
    workspace.selectedModel === LEGACY_DEFAULT_MODEL &&
    workspace.status === 'idle' &&
    !workspace.output &&
    !workspace.provider;
  return !workspace.selectedModel || isUntouchedLegacyDefault
    ? DEFAULT_MODEL
    : workspace.selectedModel;
}

interface FunctionPortalProps {
  functionId: number;
  workspaces: FunctionWorkspace[];
  onClose: () => void;
}

export default function FunctionPortal({ functionId, workspaces, onClose }: FunctionPortalProps) {
  const queryClient = useQueryClient();
  const { data: serverWorkspace, isLoading } = useGetWorkspace(functionId);
  // Reset must be ordered after any save already in flight.
  const saveWorkspace = useSaveWorkspace({ mutation: {
    scope: { id: 'workspace-writes' },
    onSuccess: workspace => {
      queryClient.setQueryData(getGetWorkspaceQueryKey(workspace.functionId), workspace);
      void queryClient.invalidateQueries({ queryKey: getListWorkspacesQueryKey() });
    },
  } });
  const transferDoc = useTransferDocument();
  const stream = useFunctionStream();
  const coherenceStream = useFunctionStream(); // Reusing hook for coherence if needed, but endpoint differs
  const activeStream = functionId === 5 ? coherenceStream : stream;
  const [runError, setRunError] = useState('');
  const currentStatus = activeStream.status !== 'idle' ? activeStream.status : (serverWorkspace?.status || 'idle');
  // A failed request must not hide a previously saved answer.
  const showingPrevious = activeStream.status !== 'idle' && !activeStream.output && !!serverWorkspace?.output;
  const currentOutput = activeStream.output || serverWorkspace?.output || '';
  const currentError = runError || activeStream.error || (activeStream.status === 'idle' ? serverWorkspace?.generationError : '');

  const [instructions, setInstructions] = useState('');
  const [instructionDraft, setInstructionDraft] = useState('');
  const [sourceDocument, setSourceDocument] = useState('');
  const [targetWords, setTargetWords] = useState<number>(functionId === 10 ? 500 : FUNCTION_MIN_WORDS[functionId]);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [thinker, setThinker] = useState('');
  const [isReadingDraft, setIsReadingDraft] = useState(false);
  const [isReadingSource, setIsReadingSource] = useState(false);
  const [isReadingAssignment, setIsReadingAssignment] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const resetting = useRef(false);
  const generationEpoch = useRef(0);
  const uploadControllers = useRef(new Set<AbortController>());
  const draftInput = useRef<HTMLInputElement>(null);
  const activeFunction = useRef<number | null>(functionId);
  useEffect(() => {
    activeFunction.current = functionId;
    setIsReadingDraft(false);
    setIsReadingSource(false);
    setIsReadingAssignment(false);
    return () => {
      activeFunction.current = null;
      for (const controller of uploadControllers.current) controller.abort();
      uploadControllers.current.clear();
    };
  }, [functionId]);
  
  const initializedForId = useRef<number | null>(null);
  const lastSaved = useRef({ instructions: '', instructionDraft: '', sourceDocument: '', targetWords: 0, selectedModel: '', thinker: '' });
  
  // Track words typed roughly
  const sourceWordCount = sourceDocument.trim() ? sourceDocument.trim().split(/\s+/).length : 0;
  const draftWordCount = instructionDraft.trim() ? instructionDraft.trim().split(/\s+/).length : 0;
  const outputWordCount = currentOutput.trim() ? currentOutput.trim().split(/\s+/).length : 0;

  useEffect(() => {
    // Reset state when switching functions
    if (serverWorkspace && initializedForId.current !== functionId) {
      initializedForId.current = functionId;
      setInstructions(serverWorkspace.instructions ?? (functionId === 1 ? DEFAULT_INSTRUCTION : ''));
      setInstructionDraft(serverWorkspace.instructionDraft || '');
      setSourceDocument(serverWorkspace.sourceDocument || '');
      setTargetWords(Math.max(serverWorkspace.targetWords || 0, FUNCTION_MIN_WORDS[functionId]));
      setSelectedModel(workspaceModel(serverWorkspace));
      setThinker(serverWorkspace.thinker || '');
      
      lastSaved.current = {
        instructions: serverWorkspace.instructions,
        instructionDraft: serverWorkspace.instructionDraft || '',
        sourceDocument: serverWorkspace.sourceDocument,
        targetWords: serverWorkspace.targetWords,
        selectedModel: serverWorkspace.selectedModel,
        thinker: serverWorkspace.thinker
      };
    } else if (!serverWorkspace && initializedForId.current !== functionId && !isLoading) {
      initializedForId.current = functionId;
      setInstructions(functionId === 1 ? DEFAULT_INSTRUCTION : '');
      setInstructionDraft('');
      setSourceDocument('');
      setTargetWords(functionId === 10 ? 500 : FUNCTION_MIN_WORDS[functionId]);
      setSelectedModel(DEFAULT_MODEL);
      setThinker('');
    }
  }, [serverWorkspace, functionId, isLoading]);

  const debouncedSave = useDebounceCallback(
    (data: any) => {
      if (resetting.current) return;
      saveWorkspace.mutate({ functionId, data });
    },
    1000
  );

  useEffect(() => {
    if (resetting.current) return;
    if (initializedForId.current !== functionId) return;
    if (targetWords < FUNCTION_MIN_WORDS[functionId]) return;
    
    const currentData = { instructions, instructionDraft, sourceDocument, targetWords, selectedModel, thinker };
    const changed = 
      currentData.instructions !== lastSaved.current.instructions ||
      currentData.instructionDraft !== lastSaved.current.instructionDraft ||
      currentData.sourceDocument !== lastSaved.current.sourceDocument ||
      currentData.targetWords !== lastSaved.current.targetWords ||
      currentData.selectedModel !== lastSaved.current.selectedModel ||
      currentData.thinker !== lastSaved.current.thinker;
      
    if (changed) {
      debouncedSave({
        ...currentData,
        status: serverWorkspace?.status || 'idle',
        output: serverWorkspace?.output || '',
        generationError: serverWorkspace?.generationError || '',
        skeleton: serverWorkspace?.skeleton || '',
        progress: serverWorkspace?.progress || 0,
        provider: serverWorkspace?.provider || '',
        quotationCount: serverWorkspace?.quotationCount || 0
      });
      lastSaved.current = currentData;
    }
  }, [instructions, instructionDraft, sourceDocument, targetWords, selectedModel, thinker, functionId, serverWorkspace, debouncedSave]);

  const handleRun = async () => {
    if (resetting.current) return;
    if (sourceWordCount > 20_000 || sourceDocument.length > 120_000) {
      setRunError('Use no more than 20,000 words or 120,000 characters of supporting material at a time (about 40 pages). Choose relevant excerpts. Nothing has been truncated.');
      return;
    }
    setRunError('');
    debouncedSave.cancel();
    const runEpoch = generationEpoch.current;
    const taskInstructions = instructions.trim() || (instructionDraft.trim() ? DEFAULT_DISSERTATION_TASK : instructions);
    const validatedTargetWords = Math.max(targetWords, FUNCTION_MIN_WORDS[functionId]);
    if (validatedTargetWords !== targetWords) setTargetWords(validatedTargetWords);
    try {
      if (functionId === 5) {
         // Coherence evaluator
          const output = await coherenceStream.startStream({
            functionId,
            instructions: taskInstructions,
            instructionDraft,
            sourceDocument,
             targetWords: validatedTargetWords,
            selectedModel,
            thinker
          }, undefined, '/api/coherence/stream');
          if (generationEpoch.current !== runEpoch) return;
          await saveWorkspace.mutateAsync({
            functionId,
            data: {
              instructions: taskInstructions,
              instructionDraft,
              sourceDocument,
              targetWords: validatedTargetWords,
              selectedModel,
              thinker,
              quotationCount: 0,
              output,
              generationError: '',
              skeleton: serverWorkspace?.skeleton || '',
              progress: 100,
              status: 'complete',
              provider: coherenceStream.provider || selectedModel,
            },
          });
      } else {
        const output = await stream.startStream({
          functionId,
          instructions: taskInstructions,
          instructionDraft,
          sourceDocument,
          targetWords: validatedTargetWords,
          selectedModel,
          thinker
        });
        if (generationEpoch.current !== runEpoch) return;
        await saveWorkspace.mutateAsync({
          functionId,
          data: {
            instructions: taskInstructions,
            instructionDraft,
            sourceDocument,
            targetWords: validatedTargetWords,
            selectedModel,
            thinker,
            quotationCount: 0,
            output,
            generationError: '',
            skeleton: serverWorkspace?.skeleton || '',
            progress: 100,
            status: 'complete',
            provider: stream.provider || selectedModel,
          },
        });
      }
    } catch (err) {
      if (generationEpoch.current !== runEpoch) return;
      const message = err instanceof Error ? err.message : 'Generation failed.';
      setRunError(message);
      // Keep partial work available after reload instead of discarding it.
      if (err instanceof GenerationFailure && err.partialOutput.trim()) {
        try {
          await saveWorkspace.mutateAsync({ functionId, data: {
            instructions: taskInstructions, instructionDraft, sourceDocument,
            targetWords: validatedTargetWords, selectedModel, thinker,
            quotationCount: 0, output: err.partialOutput,
            generationError: message, skeleton: serverWorkspace?.skeleton || '',
            progress: 0, status: err.interrupted ? 'interrupted' : 'failed',
            provider: selectedModel,
          } });
        } catch {
          setRunError(`${message} The partial text is visible below, but could not be saved. Copy or download it before leaving.`);
        }
      }
    }
  };

  const handleInterrupt = () => {
    stream.interrupt();
    coherenceStream.interrupt();
  };

  const handleClear = async () => {
    if (resetting.current) return;
    resetting.current = true;
    setIsResetting(true);
    setResetError('');
    generationEpoch.current += 1;
    debouncedSave.cancel();
    if (stream.status === 'preparing' || stream.status === 'writing') stream.interrupt();
    if (coherenceStream.status === 'preparing' || coherenceStream.status === 'writing') coherenceStream.interrupt();
    for (const controller of uploadControllers.current) controller.abort();
    uploadControllers.current.clear();
    try {
      await saveWorkspace.mutateAsync({
        functionId,
        data: {
          instructions: '',
          instructionDraft: '',
          sourceDocument: '',
          targetWords: functionId === 10 ? 500 : functionId === 1 ? 5000 : FUNCTION_MIN_WORDS[functionId],
          selectedModel: DEFAULT_MODEL,
          thinker: 'Standard NEUROTEXT style',
          quotationCount: 0,
          output: '',
          generationError: '',
          skeleton: '',
          progress: 0,
          status: 'idle',
          provider: '',
        },
      });
      window.location.reload();
    } catch {
      resetting.current = false;
      setIsResetting(false);
      setResetError('Could not reset the saved workspace. Your fields have not been cleared; please try again.');
    }
  };

  const handleCopy = () => {
    const original = currentOutput;
    const textToCopy = functionId === 8 || functionId === 9 ? normalizeAcademicContents(original) : original;
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy);
      toast.success('Copied to clipboard');
    }
  };

  const handleDownload = () => {
    const original = currentOutput;
    const textToDownload = functionId === 8 || functionId === 9 ? normalizeAcademicContents(original) : original;
    if (textToDownload) {
      const blob = new Blob([textToDownload], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `function-${functionId}-output.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handleTransfer = (destId: string) => {
    const id = parseInt(destId, 10);
    if (isNaN(id)) return;
    
    const docToTransfer = currentOutput;
    if (!docToTransfer) {
      toast.error("No output to transfer");
      return;
    }

    transferDoc.mutate({
      data: {
        sourceFunctionId: functionId,
        destinationFunctionId: id,
        document: docToTransfer
      }
    }, {
      onSuccess: () => {
        toast.success(`Transferred to Function ${id}`);
        // Optionally navigate or close, but requirements say "without clearing source"
      },
      onError: () => {
        toast.error('Failed to transfer document');
      }
    });
  };

  const handleUpload = async (files: File[] = []) => {
    if (!files.length) return;
    const uploadFunction = functionId;
    const sourceAtStart = sourceDocument;
    const controller = new AbortController();
    uploadControllers.current.add(controller);
    setIsReadingSource(true);
    setUploadError('');
    try {
      for (const file of files) {
        const text = await readDocumentUpload(file, controller.signal);
        if (activeFunction.current !== uploadFunction || controller.signal.aborted) return;
        setSourceDocument(current => functionId === 10
          ? [current, `Supporting material: ${file.name}\n${text}`].filter(Boolean).join('\n\n')
          : current === sourceAtStart ? text : `${current}\n\n${text}`);
      }
      toast.success('Source material loaded with mathematical notation preserved.');
    } catch (error) {
      if (!controller.signal.aborted && activeFunction.current === uploadFunction) {
        const apiError = error as { data?: { error?: string } };
        setUploadError(apiError.data?.error || (error instanceof Error ? error.message : 'Could not read this file.'));
      }
    } finally {
      uploadControllers.current.delete(controller);
      if (activeFunction.current === uploadFunction) setIsReadingSource(false);
    }
  };

  const handleAssignmentUpload = async (files: File[]) => {
    if (!files.length) return;
    const uploadFunction = functionId;
    const controller = new AbortController();
    uploadControllers.current.add(controller);
    setIsReadingAssignment(true);
    setUploadError('');
    try {
      for (const file of files) {
        const text = await readDocumentUpload(file, controller.signal);
        if (activeFunction.current !== uploadFunction || controller.signal.aborted) return;
        setInstructions(current => [current, text].filter(Boolean).join('\n\n'));
      }
    } catch (error) {
      if (!controller.signal.aborted && activeFunction.current === uploadFunction) {
        const apiError = error as { data?: { error?: string } };
        setUploadError(apiError.data?.error || (error instanceof Error ? error.message : 'Could not read the assignment.'));
      }
    } finally {
      uploadControllers.current.delete(controller);
      if (activeFunction.current === uploadFunction) setIsReadingAssignment(false);
    }
  };

  const handleDraftUpload = async (file?: File) => {
    if (!file) return;
    const uploadFunction = functionId;
    const controller = new AbortController();
    uploadControllers.current.add(controller);
    setIsReadingDraft(true);
    try {
      const draft = await readDocumentUpload(file, controller.signal);
      if (activeFunction.current !== uploadFunction || controller.signal.aborted) return;
      setInstructionDraft(current => appendDraft(current, draft));
      setInstructions(current => current.trim() ? current : DEFAULT_DISSERTATION_TASK);
      toast.success('Manuscript loaded separately from your instructions and reference material.');
    } catch (error) {
      if (!controller.signal.aborted && activeFunction.current === uploadFunction) {
        const apiError = error as { data?: { error?: string } };
        toast.error(apiError.data?.error || (error instanceof Error ? error.message : 'Could not read this draft. Please try again.'));
      }
    } finally {
      uploadControllers.current.delete(controller);
      if (activeFunction.current === uploadFunction) setIsReadingDraft(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="p-12 flex justify-center border border-border/50 shadow-sm">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </Card>
    );
  }

  return (
    <Card className="border border-border/60 shadow-lg bg-card overflow-hidden">
      <div className="p-6 md:p-8">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8">
          <div>
            <div className="text-[11px] font-bold text-primary tracking-widest uppercase mb-2">
              Function {functionId.toString().padStart(2, '0')}
            </div>
            <h3 className="text-2xl font-bold text-foreground">
              {FUNCTION_LABELS[functionId]}
            </h3>
            <p className="text-muted-foreground mt-2 text-sm max-w-2xl">
              {functionId === 7 ? 'Profile the author’s thinking from their writing. Supply the document first; special requirements are optional.' : functionId === 10 ? 'Paste, type or upload your assignment. NEUROTEXT answers the questions and shows the relevant working, including mathematical notation.' : 'Write a new document from scratch or transform source material into exactly what you need.'}
            </p>
            {(functionId === 8 || functionId === 9) && (
              <p className="text-xs text-muted-foreground mt-2">
                Includes a title, table of contents, {functionId === 9 ? 'five' : 'four'} clearly divided chapters, and final references.
              </p>
            )}
          </div>
          <Button variant="ghost" onClick={onClose} className="text-muted-foreground self-start shrink-0 h-8 text-xs font-semibold">
            Close Workspace
          </Button>
        </div>

        {functionId === 1 && (
          <div className="mb-10 bg-slate-50/50 p-6 rounded-xl border border-slate-100">
            <h4 className="text-[11px] font-bold text-primary tracking-widest uppercase mb-4">
              Two ways to use function 1
            </h4>
            <h5 className="font-bold text-foreground mb-4">Keep your instructions and source document completely separate</h5>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-white p-4 rounded-lg border border-border">
                <h6 className="font-semibold text-sm mb-2">1. Prompt and instructions only</h6>
                <p className="text-xs text-muted-foreground">Use the Instructions box only to tell NEUROTEXT what to do. Do not place the uploaded or pasted source document in this box.</p>
              </div>
              <div className="bg-white p-4 rounded-lg border border-border">
                <h6 className="font-semibold text-sm mb-2">2. Source document only</h6>
                <p className="text-xs text-muted-foreground">Paste or upload the paper, notes, outline, or other source material in the separate Source Document area below. It remains separate from your prompt.</p>
              </div>
            </div>
          </div>
        )}

        <fieldset disabled={isResetting} className="grid min-w-0 lg:grid-cols-[1fr_300px] gap-8">
          <div className="space-y-8">
            
            {functionId !== 7 && <section>
              <div className="mb-3">
                <div className="text-[11px] font-bold text-primary tracking-widest uppercase mb-1">
                  {functionId === 10 ? 'Step 1 • Assignment' : 'Step 1 • Instructions'}
                </div>
                <h4 className="font-bold text-foreground text-sm">
                  {functionId === 10 ? 'Enter or upload your assignment' : 'What should NEUROTEXT do?'}
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  {functionId === 10
                    ? 'Type or paste the assignment, or upload its screenshot or document below. Put any required articles or other supporting materials in Step 2.'
                    : functionId === 9
                    ? 'Tell NEUROTEXT what to do, for example: “Turn the rough draft into a proper dissertation.” Put the draft in Step 2 and supporting sources in Step 3.'
                    : 'Describe the new document you want created from scratch, or explain how NEUROTEXT should modify or use the optional source material below.'}
                </p>
              </div>
              <Textarea 
                aria-label={functionId === 10 ? 'Assignment' : 'Instructions'}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                className="min-h-[120px] text-sm resize-y"
                placeholder={functionId === 10 ? 'Enter the assignment and its questions here, or upload the assignment below...' : 'Enter instructions...'}
              />
              {functionId === 10 && (
                <div className="mt-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{instructions.trim() ? instructions.trim().split(/\s+/).length.toLocaleString() : 0} words</span>
                    <Button variant="outline" size="sm" className="h-8 text-xs font-semibold"
                      disabled={isReadingAssignment || currentStatus === 'preparing' || currentStatus === 'writing'}
                      onClick={() => document.getElementById(`assignment-upload-${functionId}`)?.click()}>
                      {isReadingAssignment ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <Upload className="w-3 h-3 mr-2" />}
                      {isReadingAssignment ? 'Reading assignment with Mathpix...' : 'Upload assignment or screenshot'}
                    </Button>
                    <input type="file" id={`assignment-upload-${functionId}`} aria-label="Upload assignment or screenshot" className="hidden" accept={DOCUMENT_UPLOAD_ACCEPT} multiple
                      onChange={event => {
                        const files = Array.from(event.target.files || []);
                        event.target.value = '';
                        void handleAssignmentUpload(files);
                      }} />
                  </div>
                  <p className="text-xs text-muted-foreground">Text/Markdown, PDF or image, up to 10 MB per file. Mathpix reads text and equations from PDFs and screenshots. Additional uploads append to your assignment.</p>
                </div>
              )}
              {functionId === 1 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  <span className="text-[11px] text-muted-foreground mt-1 mr-2">Optional instruction shortcuts:</span>
                  <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setInstructions("Turn into a pitch.")}>Pitch</Button>
                  <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setInstructions("Turn into a screenplay.")}>Screenplay</Button>
                  <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setInstructions("Turn into a master's thesis.")}>Master's thesis</Button>
                </div>
              )}
            </section>}

            {functionId === 9 && (
              <section>
                <div className="mb-3">
                  <div className="text-[11px] font-bold text-primary tracking-widest uppercase mb-1">
                    Step 2 • Upload Rough Draft • Optional
                  </div>
                  <Label htmlFor={`draft-${functionId}`} className="font-bold text-foreground text-sm">
                    The manuscript you want rewritten or developed
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Upload or paste your dissertation or preliminary draft. This is the work to transform, not a set of instructions.
                  </p>
                </div>
                <Textarea
                  id={`draft-${functionId}`}
                  value={instructionDraft}
                  onChange={event => setInstructionDraft(event.target.value)}
                  className="min-h-[200px] text-sm resize-y font-mono"
                  placeholder="Paste your rough draft here, or use Upload rough draft below..."
                />
                <div className="flex flex-wrap items-center justify-between gap-2 mt-3 px-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {draftWordCount.toLocaleString()} words
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {instructionDraft && (
                      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setInstructionDraft('')}>
                        Discard rough draft
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs font-semibold"
                      onClick={() => draftInput.current?.click()}
                      disabled={isReadingDraft || currentStatus === 'preparing' || currentStatus === 'writing'}
                    >
                      {isReadingDraft ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <Upload className="w-3 h-3 mr-2" />}
                      {isReadingDraft ? 'Reading draft...' : 'Upload rough draft'}
                    </Button>
                  </div>
                  <input
                    ref={draftInput}
                    type="file"
                    className="hidden"
                    aria-label="Upload rough draft"
                    accept={DOCUMENT_UPLOAD_ACCEPT}
                    onChange={event => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      void handleDraftUpload(file);
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Text/Markdown, PDF, PNG, JPEG, WebP or GIF, up to 10 MB. PDFs and images are sent to Mathpix to preserve equations. Additional uploads append to the draft, never to your instructions.
                </p>
              </section>
            )}

            <section>
              <div className="mb-3 flex justify-between items-end">
                <div>
                  <div className="text-[11px] font-bold text-primary tracking-widest uppercase mb-1">
                    {functionId === 7 ? 'Step 1 • Document to profile' : functionId === 10 ? 'Step 2 • Supporting materials • Optional' : functionId === 9 ? 'Step 3 • Source Material • Optional' : 'Step 2 • Source Document • Optional'}
                  </div>
                   <h4 className="font-bold text-foreground text-sm">
                     {functionId === 7
                       ? 'Enter or upload the document whose author you want profiled'
                       : functionId === 10
                       ? 'Articles, readings or other materials needed for the assignment'
                       : functionId === 9
                       ? 'Supporting references — separate from your instructions and rough draft'
                       : 'Separate from the prompt — paste or upload source material only'}
                   </h4>
                </div>
              </div>
              
              <div className="relative">
                <Textarea 
                  aria-label={functionId === 7 ? 'Document to profile' : functionId === 10 ? 'Supporting materials' : 'Source material'}
                  value={sourceDocument}
                  onChange={(e) => setSourceDocument(e.target.value)}
                  className="min-h-[250px] text-sm resize-y font-mono"
                  placeholder={functionId === 7 ? 'Paste the author’s writing here, or upload their document or screenshot below...' : functionId === 10 ? 'Paste supporting articles or readings here, or upload them below. Leave blank if the assignment needs no supporting materials.' : functionId === 9 ? 'Paste supporting reference material here, or upload text, a PDF or an image with Mathpix OCR.' : 'Paste text here, or upload text, a PDF or an image with Mathpix OCR.'}
                />
                
                <div className="flex items-center justify-between mt-3 px-1">
                  <div className="text-xs font-medium text-muted-foreground">
                    {sourceWordCount.toLocaleString()} words
                  </div>
                  <Button variant="outline" size="sm" className="h-8 text-xs font-semibold" disabled={isReadingSource || currentStatus === 'preparing' || currentStatus === 'writing'} onClick={() => document.getElementById(`upload-${functionId}`)?.click()}>
                    {isReadingSource ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <Upload className="w-3 h-3 mr-2" />}
                    {isReadingSource ? 'Reading with Mathpix...' : functionId === 7 ? 'Upload document to profile' : functionId === 10 ? 'Upload supporting materials' : 'Upload document'}
                  </Button>
                  <input
                    type="file"
                    id={`upload-${functionId}`}
                    className="hidden"
                    accept={DOCUMENT_UPLOAD_ACCEPT}
                    multiple={functionId === 10}
                    aria-label={functionId === 7 ? 'Upload document to profile' : functionId === 10 ? 'Upload supporting materials' : 'Upload document'}
                    onChange={event => {
                      const files = Array.from(event.target.files || []);
                      event.target.value = '';
                      void handleUpload(files);
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  TXT/Markdown, DOC/DOCX, PDF or image, up to 10 MB per file. PDFs and images are sent to Mathpix for text and equation recognition.
                </p>
                <p className={`text-xs mt-2 ${sourceWordCount > 20_000 || sourceDocument.length > 120_000 ? 'text-destructive' : 'text-muted-foreground'}`} role={sourceWordCount > 20_000 || sourceDocument.length > 120_000 ? 'alert' : undefined}>
                  Use at most 20,000 words or 120,000 characters here per generation — approximately 40 pages at 500 words per page, not 200 pages. Larger libraries are for storage; insert selected texts or relevant excerpts. Provider context limits may require less when combined with a long draft or output.
                </p>
                <div className="mt-3">
                  <LibraryPicker
                    currentText={sourceDocument}
                    disabled={isReadingSource || isResetting || currentStatus === 'preparing' || currentStatus === 'writing'}
                    onInsert={text => setSourceDocument(previous => previous.trim() ? `${previous.trimEnd()}\n\n${text}` : text)}
                  />
                </div>
              </div>
            </section>

            {functionId === 7 && (
              <section>
                <div className="mb-3">
                  <div className="text-[11px] font-bold text-primary tracking-widest uppercase mb-1">Step 2 • Special requirements • Optional</div>
                  <Label htmlFor="profiling-requirements" className="font-bold text-foreground text-sm">Any particular focus or requirements?</Label>
                  <p className="text-xs text-muted-foreground mt-1">Leave this blank for a cognitive profile of the author. Add a focus or preferred format only if you want one.</p>
                </div>
                <Textarea id="profiling-requirements" aria-label="Special requirements (optional)" value={instructions}
                  onChange={event => setInstructions(event.target.value)}
                  className="min-h-[120px] text-sm resize-y"
                  placeholder="Optional: focus on how the author reasons, weighs evidence, or handles objections..." />
              </section>
            )}

          </div>
          
          <div className="space-y-6">
            <section>
              <Label className="text-xs font-bold text-foreground mb-2 block">Choose LLM</Label>
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger className="w-full text-sm">
                  <SelectValue placeholder="Select LLM" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ZHI 6 · Perplexity Sonar Pro">ZHI 6 · Perplexity Sonar Pro</SelectItem>
                  <SelectItem value="ZHI 1 · OpenAI GPT-5.6 Terra">ZHI 1 · OpenAI</SelectItem>
                  <SelectItem value="ZHI 2 · Anthropic Claude Sonnet 5">ZHI 2 · Anthropic Claude</SelectItem>
                  <SelectItem value="ZHI 3 · xAI Grok 4.6">ZHI 3 · xAI Grok</SelectItem>
                  <SelectItem value="ZHI 4 · DeepSeek V4 Pro">ZHI 4 · DeepSeek</SelectItem>
                  <SelectItem value="ZHI 5 · Venice AI">ZHI 5 · Venice AI</SelectItem>
                </SelectContent>
              </Select>
            </section>

            <section>
              <Label className="text-xs font-bold text-foreground mb-2 block">Thinker perspective and style (optional)</Label>
              <Select value={thinker} onValueChange={setThinker}>
                <SelectTrigger className="w-full text-sm">
                  <SelectValue placeholder="Standard NEUROTEXT style" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Standard NEUROTEXT style</SelectItem>
                  <SelectItem value="academic">Academic / Formal</SelectItem>
                  <SelectItem value="socrates">Socratic</SelectItem>
                  <SelectItem value="nietzsche">Nietzschean</SelectItem>
                </SelectContent>
              </Select>
            </section>

            <section>
              <Label className="text-xs font-bold text-foreground mb-2 block">
                {functionId === 10 ? 'Suggested answer length' : 'Target word length'} <span className="text-muted-foreground font-normal">{functionId === 10 ? '(guidance only)' : `(min ${FUNCTION_MIN_WORDS[functionId]})`}</span>
              </Label>
              <Input 
                type="number" 
                value={targetWords || ''}
                onChange={(e) => setTargetWords(Number(e.target.value))}
                onBlur={() => {
                  if (targetWords < FUNCTION_MIN_WORDS[functionId]) {
                    setTargetWords(FUNCTION_MIN_WORDS[functionId]);
                  }
                }}
                min={FUNCTION_MIN_WORDS[functionId]}
                step={1000}
                className="w-full text-sm"
              />
            </section>

            <div className="pt-4 space-y-3">
              {(currentStatus === 'idle' || currentStatus === 'complete' || currentStatus === 'failed' || currentStatus === 'interrupted') ? (
                <Button 
                  onClick={handleRun} 
                  className="w-full font-bold text-sm h-12 shadow-sm"
                  disabled={isReadingDraft || isReadingSource || isReadingAssignment || (functionId === 7 ? !sourceDocument.trim() : functionId === 10 ? !instructions.trim() : (!instructions && !instructionDraft && !sourceDocument))}
                >
                  <Play className="w-4 h-4 mr-2" />
                  {functionId === 7 ? 'Profile author' : functionId === 10 ? 'Complete assignment' : 'Create or transform document'}
                </Button>
              ) : (
                <Button 
                  onClick={handleInterrupt} 
                  variant="destructive"
                  className="w-full font-bold text-sm h-12 shadow-sm"
                >
                  <Square className="w-4 h-4 mr-2 fill-current" />
                  Interrupt Generation
                </Button>
              )}
              
              <Button 
                onClick={handleClear} 
                variant="outline"
                className="w-full text-sm font-semibold"
              >
                {isResetting ? 'Clearing saved workspace...' : 'Clear all fields & reset'}
              </Button>
              {resetError && <p role="alert" className="text-sm text-destructive">{resetError}</p>}
              {uploadError && <p role="alert" className="text-sm text-destructive">{uploadError}</p>}
            </div>
          </div>
        </fieldset>
      </div>
      
      {/* LIVE DOCUMENT AREA */}
      {(currentStatus !== 'idle' || currentOutput) && (
        <div className="border-t border-border bg-slate-50/50">
          <div className="p-6 md:p-8">
            
            <div className="flex flex-col md:flex-row items-start justify-between gap-4 mb-6">
              <div>
                <div className="text-[11px] font-bold text-primary tracking-widest uppercase mb-2">
                  Result
                </div>
                <h3 className="text-xl font-bold text-foreground">
                  {FUNCTION_LABELS[functionId]}
                </h3>
              </div>
              
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" className="h-8 text-xs font-semibold bg-white">
                  <ArrowRight className="w-3 h-3 mr-2 rotate-180" />
                  Reuse in this function
                </Button>
                
                <Select onValueChange={handleTransfer}>
                  <SelectTrigger className="w-[200px] h-8 text-xs font-semibold bg-primary text-primary-foreground border-primary data-[state=open]:bg-primary/90">
                    <SelectValue placeholder="Send to any function..." />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(id => (
                      id !== functionId ? (
                        <SelectItem key={id} value={id.toString()} className="text-xs">
                          {id.toString().padStart(2, '0')} • {FUNCTION_LABELS[id]}
                        </SelectItem>
                      ) : null
                    ))}
                  </SelectContent>
                </Select>

                <Button variant="outline" size="sm" className="h-8 text-xs font-semibold bg-white" onClick={handleCopy}>
                  <Copy className="w-3 h-3 mr-2" />
                  Copy document
                </Button>
                <Button variant="outline" size="sm" className="h-8 text-xs font-semibold bg-white" onClick={handleDownload}>
                  <Download className="w-3 h-3 mr-2" />
                  Download .txt
                </Button>
              </div>
            </div>

            {currentError && <p role="alert" className="mb-4 text-sm text-destructive whitespace-pre-wrap">{currentError}</p>}
            {!currentError && currentStatus === 'failed' && <p role="alert" className="mb-4 text-sm text-destructive">This generation failed. The original error was not saved. Any retained text is shown below; retry to receive a new answer.</p>}
            {showingPrevious && <p className="mb-4 text-sm text-muted-foreground">Previous saved result — this is not output from the current attempt.</p>}
            <Card className="bg-white border border-border shadow-sm overflow-hidden">
              <div className="border-b border-border bg-slate-50/80 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    {currentStatus === 'preparing' || currentStatus === 'writing' ? (
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                    ) : currentStatus === 'complete' ? (
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    ) : currentStatus === 'failed' ? (
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive"></span>
                    ) : (
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                    )}
                    <span className="text-[11px] font-bold tracking-wider uppercase text-foreground">
                      Live Output • <span className="text-muted-foreground capitalize">{currentStatus}</span>
                    </span>
                  </div>
                </div>
                <div className="text-xs font-medium text-muted-foreground" data-testid="live-word-count">
                  {outputWordCount.toLocaleString()} words
                </div>
              </div>
              
              <div className="p-6 md:p-8 min-h-[400px]">
                {currentOutput ? (
                  <div 
                    className="prose prose-sm md:prose-base max-w-none prose-slate font-serif leading-relaxed"
                    data-testid="live-document-text"
                  >
                    {(functionId === 8 || functionId === 9) && currentOutput.includes('\n\nTable of Contents\n\n')
                      ? <AcademicDocument text={currentOutput} />
                      : currentOutput.split('\n\n').map((paragraph, i) => (
                        <p key={i} className="whitespace-pre-line"><MathText text={paragraph} /></p>
                      ))}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-4 py-20">
                    {currentStatus === 'preparing' ? (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                        <p className="text-sm">Analyzing source and preparing structure...</p>
                      </>
                    ) : currentStatus === 'writing' ? (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                        <p className="text-sm">Beginning generation...</p>
                      </>
                    ) : (
                      <div className="text-center">
                        <FileText className="w-12 h-12 mx-auto mb-4 opacity-20" />
                        <p className="text-sm">{currentStatus === 'failed' ? 'No new text was received. See the error above.' : currentStatus === 'interrupted' ? 'Generation stopped before any text was received.' : 'Document will appear here'}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>
            
          </div>
        </div>
      )}
      
    </Card>
  );
}
