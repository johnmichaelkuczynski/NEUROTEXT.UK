import { useState, useEffect, useRef } from 'react';
import { 
  type FunctionWorkspace, 
  useGetWorkspace, 
  useSaveWorkspace,
  useTransferDocument
} from '@workspace/api-client-react';
import { useFunctionStream } from '@/hooks/use-function-stream';
import { useDebounceCallback } from '@/hooks/use-debounce';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Play, Square, FileText, Download, Copy, Upload, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { appendInstructionDraft, readInstructionFile } from '@/lib/instruction-upload';

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
  10: 'Document Translation',
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
  10: 4000,
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
  const { data: serverWorkspace, isLoading } = useGetWorkspace(functionId);
  const saveWorkspace = useSaveWorkspace();
  const transferDoc = useTransferDocument();
  const stream = useFunctionStream();
  const coherenceStream = useFunctionStream(); // Reusing hook for coherence if needed, but endpoint differs

  const [instructions, setInstructions] = useState('');
  const [sourceDocument, setSourceDocument] = useState('');
  const [targetWords, setTargetWords] = useState<number>(FUNCTION_MIN_WORDS[functionId]);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [thinker, setThinker] = useState('');
  const [isReadingDraft, setIsReadingDraft] = useState(false);
  const draftInput = useRef<HTMLInputElement>(null);
  const activeFunction = useRef<number | null>(functionId);
  useEffect(() => {
    activeFunction.current = functionId;
    return () => { activeFunction.current = null; };
  }, [functionId]);
  
  const initializedForId = useRef<number | null>(null);
  const lastSaved = useRef({ instructions: '', sourceDocument: '', targetWords: 0, selectedModel: '', thinker: '' });
  
  // Track words typed roughly
  const sourceWordCount = sourceDocument.trim() ? sourceDocument.trim().split(/\s+/).length : 0;
  const outputWordCount = stream.output.trim() ? stream.output.trim().split(/\s+/).length : (serverWorkspace?.output?.trim() ? serverWorkspace.output.trim().split(/\s+/).length : 0);

  useEffect(() => {
    // Reset state when switching functions
    if (serverWorkspace && initializedForId.current !== functionId) {
      initializedForId.current = functionId;
      setInstructions(serverWorkspace.instructions || (functionId === 1 ? DEFAULT_INSTRUCTION : ''));
      setSourceDocument(serverWorkspace.sourceDocument || '');
      setTargetWords(Math.max(serverWorkspace.targetWords || 0, FUNCTION_MIN_WORDS[functionId]));
      setSelectedModel(workspaceModel(serverWorkspace));
      setThinker(serverWorkspace.thinker || '');
      
      lastSaved.current = {
        instructions: serverWorkspace.instructions,
        sourceDocument: serverWorkspace.sourceDocument,
        targetWords: serverWorkspace.targetWords,
        selectedModel: serverWorkspace.selectedModel,
        thinker: serverWorkspace.thinker
      };
    } else if (!serverWorkspace && initializedForId.current !== functionId && !isLoading) {
      initializedForId.current = functionId;
      setInstructions(functionId === 1 ? DEFAULT_INSTRUCTION : '');
      setSourceDocument('');
      setTargetWords(FUNCTION_MIN_WORDS[functionId]);
      setSelectedModel(DEFAULT_MODEL);
      setThinker('');
    }
  }, [serverWorkspace, functionId, isLoading]);

  const debouncedSave = useDebounceCallback(
    (data: any) => {
      saveWorkspace.mutate({ functionId, data });
    },
    1000
  );

  useEffect(() => {
    if (initializedForId.current !== functionId) return;
    if (targetWords < FUNCTION_MIN_WORDS[functionId]) return;
    
    const currentData = { instructions, sourceDocument, targetWords, selectedModel, thinker };
    const changed = 
      currentData.instructions !== lastSaved.current.instructions ||
      currentData.sourceDocument !== lastSaved.current.sourceDocument ||
      currentData.targetWords !== lastSaved.current.targetWords ||
      currentData.selectedModel !== lastSaved.current.selectedModel ||
      currentData.thinker !== lastSaved.current.thinker;
      
    if (changed) {
      debouncedSave({
        ...currentData,
        status: serverWorkspace?.status || 'idle',
        output: serverWorkspace?.output || '',
        skeleton: serverWorkspace?.skeleton || '',
        progress: serverWorkspace?.progress || 0,
        provider: serverWorkspace?.provider || '',
        quotationCount: serverWorkspace?.quotationCount || 0
      });
      lastSaved.current = currentData;
    }
  }, [instructions, sourceDocument, targetWords, selectedModel, thinker, functionId, serverWorkspace, debouncedSave]);

  const handleRun = async () => {
    const validatedTargetWords = Math.max(targetWords, FUNCTION_MIN_WORDS[functionId]);
    if (validatedTargetWords !== targetWords) setTargetWords(validatedTargetWords);
    try {
      if (functionId === 5) {
         // Coherence evaluator
          const output = await coherenceStream.startStream({
            functionId,
            instructions,
            sourceDocument,
             targetWords: validatedTargetWords,
            selectedModel,
            thinker
          }, undefined, '/api/coherence/stream');
          await saveWorkspace.mutateAsync({
            functionId,
            data: {
              instructions,
              sourceDocument,
              targetWords: validatedTargetWords,
              selectedModel,
              thinker,
              quotationCount: 0,
              output,
              skeleton: serverWorkspace?.skeleton || '',
              progress: 100,
              status: 'complete',
              provider: coherenceStream.provider || selectedModel,
            },
          });
      } else {
        const output = await stream.startStream({
          functionId,
          instructions,
          sourceDocument,
          targetWords: validatedTargetWords,
          selectedModel,
          thinker
        });
        await saveWorkspace.mutateAsync({
          functionId,
          data: {
            instructions,
            sourceDocument,
            targetWords: validatedTargetWords,
            selectedModel,
            thinker,
            quotationCount: 0,
            output,
            skeleton: serverWorkspace?.skeleton || '',
            progress: 100,
            status: 'complete',
            provider: stream.provider || selectedModel,
          },
        });
      }
    } catch (err) {
      toast.error('Failed to generate document');
    }
  };

  const handleInterrupt = () => {
    stream.interrupt();
    coherenceStream.interrupt();
  };

  const handleClear = () => {
    window.location.reload();
  };

  const handleCopy = () => {
    const textToCopy = stream.output || serverWorkspace?.output || '';
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy);
      toast.success('Copied to clipboard');
    }
  };

  const handleDownload = () => {
    const textToDownload = stream.output || serverWorkspace?.output || '';
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
    
    const docToTransfer = stream.output || serverWorkspace?.output;
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

  const handleUpload = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('text/') && !file.name.toLowerCase().endsWith('.txt')) {
      toast.error('This build currently accepts plain-text uploads. Paste extracted text for other formats.');
      return;
    }
    setSourceDocument(await file.text());
    toast.success('Document loaded');
  };

  const handleInstructionUpload = async (file?: File) => {
    if (!file) return;
    const uploadFunction = functionId;
    setIsReadingDraft(true);
    try {
      const draft = await readInstructionFile(file);
      if (activeFunction.current !== uploadFunction) return;
      setInstructions(current => appendInstructionDraft(current, draft));
      toast.success('Draft added to instructions. Your reference material is unchanged.');
    } catch (error) {
      if (activeFunction.current === uploadFunction) {
        toast.error(error instanceof Error ? error.message : 'Could not read this draft. Please try again.');
      }
    } finally {
      setIsReadingDraft(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="p-12 flex justify-center border border-border/50 shadow-sm">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </Card>
    );
  }

  const currentStatus = stream.status !== 'idle' ? stream.status : (serverWorkspace?.status || 'idle');
  const currentOutput = stream.status !== 'idle' ? stream.output : (serverWorkspace?.output || '');

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
              Write a new document from scratch or transform source material into exactly what you need.
            </p>
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

        <div className="grid lg:grid-cols-[1fr_300px] gap-8">
          <div className="space-y-8">
            
            <section>
              <div className="mb-3">
                <div className="text-[11px] font-bold text-primary tracking-widest uppercase mb-1">
                  Step 1 • Instructions
                </div>
                <h4 className="font-bold text-foreground text-sm">
                  What should NEUROTEXT do?
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  {functionId === 9
                    ? 'Describe what you want written, or upload an existing dissertation or preliminary draft here and explain how it should be polished. Keep reference material in Step 2.'
                    : 'Describe the new document you want created from scratch, or explain how NEUROTEXT should modify or use the optional source material below.'}
                </p>
              </div>
              <Textarea 
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                className="min-h-[120px] text-sm resize-y"
                placeholder="Enter instructions..."
              />
              {functionId === 9 && (
                <div className="mt-3 space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs font-semibold"
                    onClick={() => draftInput.current?.click()}
                    disabled={isReadingDraft || stream.status === 'preparing' || stream.status === 'writing'}
                  >
                    {isReadingDraft ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <Upload className="w-3 h-3 mr-2" />}
                    {isReadingDraft ? 'Reading draft...' : 'Upload draft to instructions'}
                  </Button>
                  <input
                    ref={draftInput}
                    type="file"
                    className="hidden"
                    aria-label="Upload dissertation draft to instructions"
                    accept=".txt,.md,.markdown,text/plain,text/markdown"
                    onChange={event => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      void handleInstructionUpload(file);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    .txt or .md, up to 10 MB. The draft is appended to your instructions without replacing them or changing your reference material. For Word or PDF, export as plain text first.
                  </p>
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
            </section>

            <section>
              <div className="mb-3 flex justify-between items-end">
                <div>
                  <div className="text-[11px] font-bold text-primary tracking-widest uppercase mb-1">
                    {functionId === 9 ? 'Step 2 • Reference Material • Optional' : 'Step 2 • Source Document • Optional'}
                  </div>
                   <h4 className="font-bold text-foreground text-sm">
                     {functionId === 9
                       ? 'Supporting sources only — upload your dissertation draft in Step 1'
                       : 'Separate from the prompt — paste or upload source material only'}
                   </h4>
                </div>
              </div>
              
              <div className="relative">
                <Textarea 
                  value={sourceDocument}
                  onChange={(e) => setSourceDocument(e.target.value)}
                  className="min-h-[250px] text-sm resize-y font-mono"
                  placeholder="Paste text, drag a file here, or upload a document/screenshot for OCR."
                />
                
                <div className="flex items-center justify-between mt-3 px-1">
                  <div className="text-xs font-medium text-muted-foreground">
                    {sourceWordCount.toLocaleString()} words
                  </div>
                  <Button variant="outline" size="sm" className="h-8 text-xs font-semibold" onClick={() => document.getElementById(`upload-${functionId}`)?.click()}>
                    <Upload className="w-3 h-3 mr-2" />
                    Upload document
                  </Button>
                  <input
                    type="file"
                    id={`upload-${functionId}`}
                    className="hidden"
                    accept=".txt,text/plain"
                    onChange={(event) => void handleUpload(event.target.files?.[0])}
                  />
                </div>
              </div>
            </section>

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
                Target word length <span className="text-muted-foreground font-normal">(min {FUNCTION_MIN_WORDS[functionId]})</span>
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
                  disabled={isReadingDraft || (!instructions && !sourceDocument)}
                >
                  <Play className="w-4 h-4 mr-2" />
                  Create or transform document
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
                Clear all fields & reset
              </Button>
            </div>
          </div>
        </div>
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
                    {currentOutput.split('\n\n').map((paragraph, i) => (
                      <p key={i}>{paragraph}</p>
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
                        <p className="text-sm">Document will appear here</p>
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
