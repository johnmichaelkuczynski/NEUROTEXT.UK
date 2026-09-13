import { useState } from 'react';
import { useListWorkspaces, useGetUsage, type FunctionWorkspace } from '@workspace/api-client-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import FunctionPortal from '@/components/function-portal';

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

export default function Dashboard() {
  const { data: workspaces, isLoading } = useListWorkspaces();
  const { data: usage } = useGetUsage();
  
  const [selectedFunctionId, setSelectedFunctionId] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const workspaceMap = new Map(workspaces?.map((w) => [w.functionId, w]));

  const handleFunctionClick = (id: number) => {
    setSelectedFunctionId(id);
  };

  return (
    <div className="min-h-[100dvh] bg-background">
      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-12">
        
        {!selectedFunctionId && (
          <div className="mb-12">
            <h1 className="text-[11px] font-bold tracking-widest text-primary uppercase mb-4">
              Document Intelligence Platform
            </h1>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground mb-4 max-w-2xl">
              Work with a document. Get a coherent result.
            </h2>
            <p className="text-muted-foreground text-sm md:text-base max-w-3xl">
              Every function has its own dedicated document portal. Choose a function, provide its document, choose an LLM, then run it.
            </p>
          </div>
        )}

        <div className={cn(
          "grid gap-4",
          selectedFunctionId 
            ? "grid-cols-2 sm:grid-cols-5 opacity-70 hover:opacity-100 transition-opacity" 
            : "grid-cols-2 md:grid-cols-3 lg:grid-cols-5"
        )}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => {
            const workspace = workspaceMap.get(id);
            const isSelected = selectedFunctionId === id;
            const hasData = workspace && (workspace.output || workspace.sourceDocument || workspace.status !== 'idle');
            
            return (
              <Card 
                key={id}
                onClick={() => handleFunctionClick(id)}
                className={cn(
                  "cursor-pointer transition-all duration-200 border",
                  isSelected 
                    ? "border-primary bg-primary/5 ring-1 ring-primary/20" 
                    : "border-border hover:border-primary/50 hover:bg-slate-50/50",
                  "flex flex-col p-4 md:p-5 h-full min-h-[120px]"
                )}
              >
                <div className="text-xs font-bold text-primary mb-2">
                  {id.toString().padStart(2, '0')}
                </div>
                <div className="font-semibold text-sm leading-snug mb-auto text-foreground">
                  {FUNCTION_LABELS[id]}
                </div>
                {hasData && !isSelected && (
                  <div className="text-[11px] font-semibold text-emerald-600 mt-4">
                    Paper retained
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        {selectedFunctionId && (
          <div className="mt-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <FunctionPortal 
              functionId={selectedFunctionId} 
              workspaces={workspaces || []}
              onClose={() => setSelectedFunctionId(null)}
            />
          </div>
        )}
      </main>
    </div>
  );
}
