import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { ArrowUpRight, BrainCircuit, Check, ChevronRight, CircleAlert, FilePlus2, Layers3, Loader2, Plus, RefreshCw, Search, Sparkles, Target, WandSparkles, X } from 'lucide-react';
import { getGetDocumentsQueryKey, getGetJobsQueryKey, getGetWorkspaceSummaryQueryKey, useCreateDocument, useCreateGenerationJob, useGetDocuments, useGetJobs, useGetWorkspaceSummary } from '@workspace/api-client-react';
import { Modal } from '@/components/modal';
import type { Document, GenerationJob } from '@workspace/api-client-react';

type DocumentForm = { title: string; content: string };
type JobForm = { title: string; feature: string; provider: string };

const providerOptions = ['ZHI / core', 'ZHI / reasoning', 'ZHI / style', 'ZHI / concise', 'ZHI / critic', 'ZHI / synthesis'];

const fallbackDocs: Document[] = [
  { id: 'sample-1', title: 'The geometry of a good question', excerpt: 'A field note on how constraint changes the quality of thought...', words: 1842, score: 88, updatedAt: 'Today, 09:42', status: 'Analyzed' },
  { id: 'sample-2', title: 'Notes on institutional memory', excerpt: 'Organizations do not forget. They misplace the evidence of having known...', words: 3290, score: 76, updatedAt: 'Yesterday, 16:18', status: 'Draft' },
  { id: 'sample-3', title: 'Signal, noise, and the useful pause', excerpt: 'When speed becomes a proxy for rigor, the pause becomes a method...', words: 946, score: 91, updatedAt: 'Mon, 11:05', status: 'Analyzed' },
];

function Skeleton({ className = '' }: { className?: string }) { return <div className={`animate-pulse rounded bg-muted ${className}`} />; }

function Metric({ label, value, detail, accent = false }: { label: string; value: string; detail: string; accent?: boolean }) {
  return <div className={`border-l-2 pl-4 ${accent ? 'border-[#c4e538]' : 'border-border'}`} data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}>
    <div className="font-mono text-[9px] uppercase tracking-[.17em] text-muted-foreground">{label}</div>
    <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
    <div className="mt-1 text-[11px] text-muted-foreground">{detail}</div>
  </div>;
}

function DocumentCard({ document, selected, onSelect }: { document: Document; selected: boolean; onSelect: () => void }) {
  return <button onClick={onSelect} className={`focus-ring group w-full border-b border-border/80 px-5 py-4 text-left transition-colors hover:bg-muted/55 ${selected ? 'bg-[#e7edbf]/45 dark:bg-[#c4e538]/10' : ''}`} data-testid={`card-document-${document.id}`}>
    <div className="flex items-start gap-3">
      <div className={`mt-1 grid size-7 shrink-0 place-items-center rounded-md border ${selected ? 'border-[#c4e538] bg-[#c4e538]/30 text-foreground' : 'border-border text-muted-foreground'}`}><span className="font-mono text-[9px]">{document.title.slice(0, 2).toUpperCase()}</span></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-[13px] font-semibold">{document.title}</span>
          <span className={`shrink-0 font-mono text-[10px] ${document.score >= 85 ? 'text-[#4f9698]' : 'text-muted-foreground'}`}>{document.score}/100</span>
        </div>
        <p className="mt-1 line-clamp-1 text-[11px] leading-relaxed text-muted-foreground">{document.excerpt}</p>
        <div className="mt-2 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[.08em] text-muted-foreground/80"><span>{document.words.toLocaleString()} words</span><span className="size-0.5 rounded-full bg-muted-foreground/50" /><span>{document.status}</span></div>
      </div>
      <ChevronRight size={14} className={`mt-2 text-muted-foreground transition-transform group-hover:translate-x-0.5 ${selected ? 'text-foreground' : ''}`} />
    </div>
  </button>;
}

function ActivityFeed({ activities }: { activities: { id: string; label: string; detail: string; timestamp: string; tone: string }[] }) {
  const rows = activities.length ? activities : [
    { id: 'a1', label: 'Workspace initialized', detail: 'Six providers are available for evaluation', timestamp: 'Just now', tone: 'teal' },
    { id: 'a2', label: 'No recent runs', detail: 'Start a generation job to populate this feed', timestamp: '—', tone: 'muted' },
  ];
  return <div className="space-y-0" data-testid="list-recent-activity">{rows.slice(0, 4).map((activity) => <div key={activity.id} className="flex gap-3 border-b border-border/65 py-3 last:border-0">
    <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${activity.tone === 'warning' ? 'bg-[#ef7655]' : activity.tone === 'success' || activity.tone === 'teal' ? 'bg-[#6caeb0]' : 'bg-muted-foreground/40'}`} />
    <div className="min-w-0 flex-1"><div className="text-[11px] font-medium">{activity.label}</div><div className="mt-0.5 truncate text-[10px] text-muted-foreground">{activity.detail}</div></div>
    <time className="shrink-0 font-mono text-[9px] text-muted-foreground">{activity.timestamp}</time>
  </div>)}</div>;
}

function JobsStrip({ jobs, onNew }: { jobs: GenerationJob[]; onNew: () => void }) {
  return <section className="rounded-xl border border-border bg-card" data-testid="section-active-jobs">
    <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><div className="font-mono text-[9px] uppercase tracking-[.18em] text-muted-foreground">Processing queue</div><h2 className="mt-1 text-[15px] font-semibold">Active generation jobs</h2></div><button onClick={onNew} className="focus-ring flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-[11px] font-medium transition-colors hover:bg-muted" data-testid="button-new-job"><Plus size={13} /> New job</button></div>
    {jobs.length === 0 ? <div className="flex items-center gap-4 px-5 py-8"><div className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground"><Layers3 size={17} /></div><div><div className="text-[12px] font-medium">Queue is clear</div><div className="mt-1 text-[11px] text-muted-foreground">Your next run will appear here with live progress.</div></div></div> :
      <div className="grid gap-px bg-border md:grid-cols-2">{jobs.slice(0, 4).map((job) => <div className="bg-card p-4" key={job.id} data-testid={`job-card-${job.id}`}><div className="flex items-center justify-between gap-3"><div className="truncate text-[12px] font-medium">{job.title}</div><span className={`font-mono text-[9px] uppercase ${job.status === 'completed' ? 'text-[#4f9698]' : 'text-[#ef7655]'}`}>{job.status}</span></div><div className="mt-2 flex items-center justify-between font-mono text-[9px] text-muted-foreground"><span>{job.provider}</span><span>{job.progress}%</span></div><div className="mt-2 h-1 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${job.status === 'completed' ? 'bg-[#6caeb0]' : 'bg-[#ef7655]'}`} style={{ width: `${Math.max(5, job.progress)}%` }} /></div></div>)}</div>}
  </section>;
}

export default function Workspace() {
  const queryClient = useQueryClient();
  const summaryQuery = useGetWorkspaceSummary({ query: { queryKey: getGetWorkspaceSummaryQueryKey(), staleTime: 20_000 } });
  const docsQuery = useGetDocuments({ query: { queryKey: getGetDocumentsQueryKey(), staleTime: 20_000 } });
  const jobsQuery = useGetJobs({ query: { queryKey: getGetJobsQueryKey(), refetchInterval: 10_000 } });
  const createDocument = useCreateDocument();
  const createJob = useCreateGenerationJob();
  const [docOpen, setDocOpen] = useState(false);
  const [jobOpen, setJobOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const docForm = useForm<DocumentForm>({ defaultValues: { title: '', content: '' } });
  const jobForm = useForm<JobForm>({ defaultValues: { title: '', feature: 'Deep analysis', provider: providerOptions[0] } });
  const summary = summaryQuery.data;
  const documents = useMemo(() => (docsQuery.data?.length ? docsQuery.data : fallbackDocs).filter((doc) => `${doc.title} ${doc.excerpt}`.toLowerCase().includes(search.toLowerCase())), [docsQuery.data, search]);
  const jobs = jobsQuery.data ?? [];
  const selected = documents.find((doc) => doc.id === selectedId) ?? documents[0];
  const busy = createDocument.isPending || createJob.isPending;

  const submitDocument = docForm.handleSubmit((data) => createDocument.mutate({ data }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetDocumentsQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetWorkspaceSummaryQueryKey() }); setDocOpen(false); docForm.reset(); } }));
  const submitJob = jobForm.handleSubmit((data) => createJob.mutate({ data }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetJobsQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetWorkspaceSummaryQueryKey() }); setJobOpen(false); jobForm.reset({ title: '', feature: 'Deep analysis', provider: providerOptions[0] }); } }));
  const refresh = () => { void Promise.all([summaryQuery.refetch(), docsQuery.refetch(), jobsQuery.refetch()]); };

  return <div className="instrument-grid min-h-[calc(100dvh-76px)] px-5 py-7 md:px-9 md:py-9">
    <div className="mx-auto max-w-[1500px]">
      <div className="animate-rise-in mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div><div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.2em] text-[#4f9698]"><span className="size-1.5 rounded-full bg-[#6caeb0]" /> live workspace</div><h1 className="text-3xl font-semibold tracking-[-.04em] md:text-[40px]">Make the thinking<br className="hidden md:block" /> legible.</h1><p className="mt-3 max-w-xl text-[13px] leading-relaxed text-muted-foreground">Inspect, strengthen, and transform complex writing across the ZHI model mesh.</p></div>
        <div className="flex items-center gap-2"><button onClick={refresh} className="focus-ring flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-[11px] font-medium hover:bg-muted" data-testid="button-refresh-workspace"><RefreshCw size={13} className={summaryQuery.isFetching ? 'animate-spin' : ''} /> Sync</button><button onClick={() => setDocOpen(true)} className="focus-ring flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-[11px] font-semibold text-primary-foreground hover:opacity-90" data-testid="button-add-document"><FilePlus2 size={14} /> Add document</button></div>
      </div>

      <div className="mb-8 grid gap-7 md:grid-cols-5">
        <Metric label="Documents" value={summary ? summary.documents.toString().padStart(2, '0') : '—'} detail="in current workspace" accent />
        <Metric label="Active jobs" value={summary ? summary.activeJobs.toString().padStart(2, '0') : '—'} detail="processing now" />
        <Metric label="Words processed" value={summary ? `${(summary.wordsProcessed / 1000).toFixed(1)}k` : '—'} detail="across all documents" />
        <Metric label="Intelligence score" value={summary ? `${summary.intelligenceScore}` : '—'} detail="workspace baseline" accent />
        <Metric label="Credits remaining" value={summary ? summary.credits.toLocaleString() : '—'} detail="renew in 12 days" />
      </div>

      <div className="grid gap-7 xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,.82fr)]">
        <section className="animate-rise-in delay-1 overflow-hidden rounded-xl border border-border bg-card" data-testid="section-document-library">
          <div className="flex flex-col gap-4 border-b border-border px-5 py-5 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-mono text-[9px] uppercase tracking-[.18em] text-muted-foreground">Corpus index / 03</div><h2 className="mt-1 text-[15px] font-semibold">Recent documents</h2></div><div className="flex items-center gap-2"><div className="relative"><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="focus-ring h-8 w-[180px] rounded-md border border-border bg-background pl-8 pr-3 text-[11px] outline-none placeholder:text-muted-foreground" placeholder="Filter corpus..." data-testid="input-search-documents" /></div><button onClick={() => setDocOpen(true)} className="focus-ring grid size-8 place-items-center rounded-md border border-border hover:bg-muted" data-testid="button-add-document-compact" aria-label="Add document"><Plus size={15} /></button></div></div>
          {docsQuery.isLoading ? <div className="space-y-4 p-5"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div> : docsQuery.isError ? <div className="flex items-center gap-3 p-7 text-[12px]"><CircleAlert size={17} className="text-destructive" /><div><div className="font-medium">Corpus unavailable</div><div className="mt-1 text-muted-foreground">Try syncing the workspace again.</div></div></div> : documents.length === 0 ? <div className="p-8 text-center"><div className="mx-auto grid size-10 place-items-center rounded-full bg-muted"><Search size={17} className="text-muted-foreground" /></div><div className="mt-3 text-[12px] font-medium">No matching documents</div><div className="mt-1 text-[11px] text-muted-foreground">Adjust your filter or add a new document.</div></div> : <div>{documents.map((document) => <DocumentCard key={document.id} document={document} selected={selected?.id === document.id} onSelect={() => setSelectedId(document.id)} />)}</div>}
          <div className="flex items-center justify-between border-t border-border bg-muted/35 px-5 py-3"><span className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">{documents.length} indexed records</span><Link href="/history" className="focus-ring flex items-center gap-1 text-[10px] font-medium hover:text-[#4f9698]" data-testid="link-view-all-jobs">View job history <ArrowUpRight size={12} /></Link></div>
        </section>

        <div className="space-y-7">
          <section className="animate-rise-in delay-2 overflow-hidden rounded-xl border border-border bg-[#173342] text-[#f4f0e8]" data-testid="section-analysis-console">
            <div className="relative p-6"><div className="absolute right-0 top-0 h-full w-1/2 overflow-hidden opacity-30"><div className="instrument-grid absolute inset-0 border-l border-[#76c7c8]/20" /><div className="animate-scan absolute left-0 top-0 h-10 w-full bg-[#c4e538]/20 blur-xl" /></div><div className="relative"><div className="flex items-start justify-between"><div><div className="font-mono text-[9px] uppercase tracking-[.18em] text-[#76c7c8]">Selected specimen</div><h2 className="mt-2 max-w-[250px] text-[19px] font-semibold leading-tight">{selected?.title ?? 'No specimen selected'}</h2></div><div className="grid size-12 place-items-center rounded-full border border-[#c4e538]/70"><span className="font-mono text-[13px] text-[#c4e538]">{selected?.score ?? '—'}</span></div></div>{selected && <><p className="mt-4 text-[11px] leading-relaxed text-[#f4f0e8]/60">{selected.excerpt}</p><div className="mt-6 flex flex-wrap gap-2">{['Coherence', 'Voice', 'Evidence'].map((label, index) => <span key={label} className="rounded border border-[#f4f0e8]/15 px-2 py-1 font-mono text-[9px] uppercase tracking-[.08em] text-[#f4f0e8]/65">{label} <b className="ml-1 font-medium text-[#c4e538]">{[92, 81, 76][index]}</b></span>)}</div><button onClick={() => setJobOpen(true)} className="focus-ring mt-7 flex w-full items-center justify-center gap-2 rounded-md bg-[#c4e538] px-4 py-3 text-[11px] font-bold text-[#173342] hover:bg-[#d3ee54]" data-testid="button-analyze-selected"><BrainCircuit size={15} /> Run deep analysis</button></>}</div></div>
          </section>
          <section className="animate-rise-in delay-3 rounded-xl border border-border bg-card px-5 py-5" data-testid="section-activity"><div className="mb-2 flex items-center justify-between"><div><div className="font-mono text-[9px] uppercase tracking-[.18em] text-muted-foreground">Signal log</div><h2 className="mt-1 text-[14px] font-semibold">Recent activity</h2></div><Sparkles size={15} className="text-[#ef7655]" /></div><ActivityFeed activities={summary?.recentActivity ?? []} /></section>
        </div>
      </div>
      <div className="animate-rise-in delay-4 mt-7"><JobsStrip jobs={jobs} onNew={() => setJobOpen(true)} /></div>
    </div>

    <Modal open={docOpen} onClose={() => setDocOpen(false)} title="Add to corpus" eyebrow="New document">
      <form onSubmit={submitDocument} className="space-y-4">
        <label className="block"><span className="mb-2 block font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground">Document title</span><input {...docForm.register('title', { required: 'A title is required' })} className="focus-ring h-11 w-full rounded-md border border-input bg-background px-3 text-[13px] outline-none" placeholder="e.g. The architecture of trust" data-testid="input-document-title" />{docForm.formState.errors.title && <span className="mt-1 block text-[10px] text-destructive">{docForm.formState.errors.title.message}</span>}</label>
        <label className="block"><span className="mb-2 block font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground">Source text</span><textarea {...docForm.register('content', { required: 'Source text is required', minLength: { value: 20, message: 'Add at least 20 characters' } })} className="focus-ring min-h-[170px] w-full resize-y rounded-md border border-input bg-background p-3 text-[13px] leading-relaxed outline-none" placeholder="Paste the writing you want to inspect..." data-testid="textarea-document-content" />{docForm.formState.errors.content && <span className="mt-1 block text-[10px] text-destructive">{docForm.formState.errors.content.message}</span>}</label>
        <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => setDocOpen(false)} className="focus-ring rounded-md px-4 py-2.5 text-[11px] font-medium text-muted-foreground hover:bg-muted" data-testid="button-cancel-document">Cancel</button><button type="submit" disabled={busy} className="focus-ring flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-[11px] font-semibold text-primary-foreground disabled:opacity-60" data-testid="button-submit-document">{createDocument.isPending && <Loader2 size={13} className="animate-spin" />} Index document</button></div>
      </form>
    </Modal>
    <Modal open={jobOpen} onClose={() => setJobOpen(false)} title="Start a generation job" eyebrow="ZHI execution">
      <form onSubmit={submitJob} className="space-y-4">
        <label className="block"><span className="mb-2 block font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground">Job title</span><input {...jobForm.register('title', { required: 'A job title is required' })} className="focus-ring h-11 w-full rounded-md border border-input bg-background px-3 text-[13px] outline-none" placeholder={selected ? `Analyze — ${selected.title}` : 'Name this run'} data-testid="input-job-title" />{jobForm.formState.errors.title && <span className="mt-1 block text-[10px] text-destructive">{jobForm.formState.errors.title.message}</span>}</label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block"><span className="mb-2 block font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground">Operation</span><select {...jobForm.register('feature')} className="focus-ring h-11 w-full rounded-md border border-input bg-background px-3 text-[12px] outline-none" data-testid="select-job-feature">{['Deep analysis', 'Tighten argument', 'Extract outline', 'Change register'].map((feature) => <option key={feature}>{feature}</option>)}</select></label><label className="block"><span className="mb-2 block font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground">Primary provider</span><select {...jobForm.register('provider')} className="focus-ring h-11 w-full rounded-md border border-input bg-background px-3 text-[12px] outline-none" data-testid="select-job-provider">{providerOptions.map((provider) => <option key={provider}>{provider}</option>)}</select></label></div>
        <div className="rounded-md border border-[#6caeb0]/35 bg-[#6caeb0]/10 p-3 text-[11px] leading-relaxed text-muted-foreground"><Target size={14} className="mb-1 text-[#4f9698]" />The selected provider will be evaluated against the full six-node mesh before results are returned.</div>
        <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => setJobOpen(false)} className="focus-ring rounded-md px-4 py-2.5 text-[11px] font-medium text-muted-foreground hover:bg-muted" data-testid="button-cancel-job">Cancel</button><button type="submit" disabled={busy} className="focus-ring flex items-center gap-2 rounded-md bg-[#ef7655] px-4 py-2.5 text-[11px] font-semibold text-[#173342] disabled:opacity-60" data-testid="button-submit-job">{createJob.isPending ? <Loader2 size={13} className="animate-spin" /> : <WandSparkles size={13} />} Queue job</button></div>
      </form>
    </Modal>
  </div>;
}