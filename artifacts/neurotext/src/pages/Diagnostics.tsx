import { useGetDiagnostics } from '@workspace/api-client-react';
import { Card } from '@/components/ui/card';
import { Loader2, Activity, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { format } from 'date-fns';

export default function Diagnostics() {
  const { data: diagnostics, isLoading } = useGetDiagnostics();

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <main className="max-w-[1000px] mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-10">
          <h1 className="text-[11px] font-bold tracking-widest text-primary uppercase mb-2">
            Owner Controls
          </h1>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-4">
            System Diagnostics
          </h2>
          <p className="text-muted-foreground text-sm max-w-2xl">
            Live transcript evidence, diagnostic presets, and historical performance metrics.
          </p>
        </div>

        <div className="space-y-6">
          {diagnostics?.map((diag) => (
            <Card key={diag.id} className="p-6 border-border shadow-sm flex flex-col md:flex-row gap-6 items-start md:items-center">
              
              <div className="flex items-center justify-center w-12 h-12 rounded-full shrink-0 bg-slate-100">
                {diag.status === 'pass' ? (
                  <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                ) : diag.status === 'fail' ? (
                  <XCircle className="w-6 h-6 text-destructive" />
                ) : (
                  <Loader2 className="w-6 h-6 text-amber-500 animate-spin" />
                )}
              </div>

              <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4 w-full">
                <div>
                  <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Function</div>
                  <div className="text-sm font-semibold">{diag.functionName}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Model</div>
                  <div className="text-sm font-semibold truncate" title={diag.selectedModel}>{diag.selectedModel?.split(':').pop() || 'Unknown'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Latency (First word)</div>
                  <div className="text-sm font-semibold flex items-center gap-1">
                    <Activity className="w-3 h-3 text-muted-foreground" />
                    {diag.firstWordMs}ms
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Date</div>
                  <div className="text-sm font-semibold flex items-center gap-1">
                    <Clock className="w-3 h-3 text-muted-foreground" />
                    {format(new Date(diag.createdAt), 'MMM d, HH:mm')}
                  </div>
                </div>
              </div>

              {diag.cause && (
                <div className="w-full md:w-auto bg-destructive/10 text-destructive text-xs px-3 py-1.5 rounded-md font-medium">
                  {diag.cause}
                </div>
              )}
            </Card>
          ))}
          
          {(!diagnostics || diagnostics.length === 0) && (
            <Card className="p-12 border-border shadow-sm flex flex-col items-center justify-center text-muted-foreground">
              <Activity className="w-12 h-12 mb-4 opacity-20" />
              <p>No diagnostic runs recorded yet.</p>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
