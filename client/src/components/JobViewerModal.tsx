import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { useActiveJob } from '@/contexts/ActiveJobContext';
import {
  Copy,
  Download,
  CheckCircle,
  Clock,
  AlertCircle,
  FileText,
  Loader2,
  X,
  RefreshCw
} from 'lucide-react';

interface Chunk {
  id: number;
  chunkIndex: number;
  chunkText: string;
  evaluationResult: any;
  stateAfter: any;
  createdAt: string;
}

interface JobData {
  id?: number;
  documentId: string;
  coherenceMode: string;
  status: string;
  chunkCount: number;
  globalState?: any;
  createdAt?: string;
  updatedAt?: string;
  stitchedOutput?: string;
}

export function JobViewerModal() {
  const { viewerOpen, closeViewer, viewJobId, activeJob } = useActiveJob();
  const [jobData, setJobData] = useState<JobData | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'combined' | 'chunks'>('combined');
  const { toast } = useToast();
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const isProcessing = activeJob?.isProcessing && activeJob?.documentId === viewJobId;

  const fetchJobData = useCallback(async () => {
    if (!viewJobId) return;
    
    setLoading(true);
    try {
      const response = await fetch(`/api/jobs/${viewJobId}`);
      if (response.ok) {
        const data = await response.json();
        setJobData({
          documentId: viewJobId,
          coherenceMode: data.document?.coherence_mode || data.document?.coherenceMode || 'Unknown',
          status: data.document?.status || (data.chunks?.length > 0 ? 'in-progress' : 'pending'),
          chunkCount: data.chunks?.length || 0,
          globalState: data.document?.global_state || data.document?.globalState,
          createdAt: data.document?.created_at || data.document?.createdAt,
          stitchedOutput: data.document?.stitched_output || data.document?.stitchedOutput
        });
        setChunks(data.chunks || []);
      }
    } catch (error) {
      console.error('Error fetching job data:', error);
    } finally {
      setLoading(false);
    }
  }, [viewJobId]);

  useEffect(() => {
    if (viewerOpen && viewJobId) {
      fetchJobData();
      
      if (isProcessing) {
        pollIntervalRef.current = setInterval(fetchJobData, 3000);
      }
    }
    
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [viewerOpen, viewJobId, isProcessing, fetchJobData]);

  useEffect(() => {
    if (!viewerOpen) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }
  }, [viewerOpen]);

  const getCombinedText = useCallback(() => {
    if (jobData?.stitchedOutput) {
      return jobData.stitchedOutput;
    }
    if (chunks.length === 0) return '';
    return chunks
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .map(c => c.chunkText)
      .join('\n\n');
  }, [chunks, jobData?.stitchedOutput]);

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({
        title: 'Copied',
        description: 'Content copied to clipboard',
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to copy to clipboard',
        variant: 'destructive',
      });
    }
  }, [toast]);

  const handleDownload = useCallback(() => {
    const text = getCombinedText();
    if (!text) return;
    
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `job-${viewJobId}-output.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast({
      title: 'Downloaded',
      description: 'Output saved to file',
    });
  }, [getCombinedText, viewJobId, toast]);

  const wordCount = useCallback((text: string) => {
    return text.trim().split(/\s+/).filter(w => w).length;
  }, []);

  const combinedText = getCombinedText();
  const totalWords = wordCount(combinedText);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"><CheckCircle className="w-3 h-3 mr-1" /> Completed</Badge>;
      case 'in-progress':
      case 'processing':
        return <Badge className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"><Clock className="w-3 h-3 mr-1 animate-spin" /> Processing</Badge>;
      case 'interrupted':
        return <Badge className="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300"><AlertCircle className="w-3 h-3 mr-1" /> Interrupted</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <Dialog open={viewerOpen} onOpenChange={(open) => !open && closeViewer()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col" data-testid="job-viewer-modal">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <DialogTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Job Output
              </DialogTitle>
              {jobData && getStatusBadge(isProcessing ? 'processing' : jobData.status)}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={fetchJobData}
                disabled={loading}
                data-testid="button-refresh-job"
              >
                <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleCopy(combinedText)}
                disabled={!combinedText}
                data-testid="button-copy-output"
              >
                {copied ? <CheckCircle className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
                {copied ? 'Copied' : 'Copy All'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDownload}
                disabled={!combinedText}
                data-testid="button-download-output"
              >
                <Download className="w-4 h-4 mr-1" />
                Download
              </Button>
            </div>
          </div>
        </DialogHeader>

        {loading && chunks.length === 0 ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center gap-4 mb-4 text-sm text-muted-foreground flex-wrap">
              <span><strong>Mode:</strong> {jobData?.coherenceMode || 'Unknown'}</span>
              <span><strong>Chunks:</strong> {chunks.length}</span>
              <span><strong>Words:</strong> {totalWords.toLocaleString()}</span>
              {isProcessing && (
                <Badge className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  Live - Auto-refreshing
                </Badge>
              )}
            </div>

            {isProcessing && activeJob && (
              <div className="mb-4">
                <Progress 
                  value={activeJob.totalChunks > 0 ? (activeJob.completedChunks / activeJob.totalChunks) * 100 : 0} 
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {activeJob.completedChunks} of {activeJob.totalChunks} chunks processed
                </p>
              </div>
            )}

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'combined' | 'chunks')} className="flex-1 flex flex-col overflow-hidden">
              <TabsList className="flex-shrink-0">
                <TabsTrigger value="combined" data-testid="tab-combined">Combined Output</TabsTrigger>
                <TabsTrigger value="chunks" data-testid="tab-chunks">Individual Chunks ({chunks.length})</TabsTrigger>
              </TabsList>
              
              <TabsContent value="combined" className="flex-1 overflow-hidden mt-4">
                <ScrollArea className="h-[50vh] border rounded-md p-4 bg-muted/20">
                  {combinedText ? (
                    <pre className="whitespace-pre-wrap text-sm font-mono">{combinedText}</pre>
                  ) : (
                    <p className="text-muted-foreground text-center py-8">
                      {isProcessing ? 'Waiting for chunks to complete...' : 'No output generated yet'}
                    </p>
                  )}
                </ScrollArea>
              </TabsContent>
              
              <TabsContent value="chunks" className="flex-1 overflow-hidden mt-4">
                <ScrollArea className="h-[50vh]">
                  {chunks.length > 0 ? (
                    <div className="space-y-4">
                      {chunks.sort((a, b) => a.chunkIndex - b.chunkIndex).map((chunk) => (
                        <div 
                          key={chunk.id || chunk.chunkIndex} 
                          className="border rounded-md p-4 bg-muted/20"
                          data-testid={`chunk-${chunk.chunkIndex}`}
                        >
                          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                            <Badge variant="outline">Chunk {chunk.chunkIndex + 1}</Badge>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">
                                {wordCount(chunk.chunkText || '')} words
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleCopy(chunk.chunkText || '')}
                                data-testid={`button-copy-chunk-${chunk.chunkIndex}`}
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                          <pre className="whitespace-pre-wrap text-sm font-mono">{chunk.chunkText}</pre>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-8">
                      {isProcessing ? 'Waiting for chunks to complete...' : 'No chunks generated yet'}
                    </p>
                  )}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
