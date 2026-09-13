import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Copy, Download, FileText, Loader2, Mail, Play, Repeat2, Save, ShieldCheck, Sparkles, Upload, X } from "lucide-react";
import type { AuthUser } from "@/App";
import { diagnosticTheses } from "@/data/diagnostic-theses";

type Portal = {
  id: string;
  number: string;
  title: string;
  description: string;
  ownerOnly?: boolean;
  placeholder: string;
  action: string;
};

type CoherenceDimension = {
  label: string;
  score: number;
  note: string;
};

type CoherenceScorecard = {
  mode: string;
  score: number | null;
  verdict: string;
  dimensions: CoherenceDimension[];
};

type AiDetection = {
  aiProbability: number;
  label: string;
  explanation: string;
  providerUsed: string;
};

type FreeUsage = {
  authenticated: boolean;
  usedOperations: number;
  limitOperations: number;
  remainingOperations: number;
  unlimited?: boolean;
  ownerAccess?: boolean;
  accessTier?: string;
};

type BillingPayment = {
  amount: number | null;
  currency: string | null;
  created: number;
  mode: "payment" | "setup" | "subscription";
};

type SubscriptionPlan = {
  active: boolean;
  amount: number | null;
  currency: string;
  interval: string | null;
  name: string;
  description: string;
};

type DiagnosticResult = {
  id: string;
  title: string;
  status: string;
  input: string;
  output: string;
  providerUsed: string;
  elapsedMs: number;
  firstWordMs: number | null;
  wordCount: number;
  completed: boolean;
  failureCause?: string;
  failureEvidence?: string;
  automaticRecovery?: string;
};

type SavedDraft = {
  active: string;
  text: string;
  instructions: string;
  targetWords: string;
  model: string;
  thinker: string;
  quotes: number;
  output: string;
  skeleton: string;
};

type FunctionWorkspace = {
  text: string;
  instructions: string;
  targetWords: string;
  model: string;
  thinker: string;
  quotes: number;
  output: string;
  skeleton: string;
  score: number | null;
  coherenceMode: string;
  coherenceScorecard: CoherenceScorecard | null;
  coherenceProviderUsed: string;
  skeletonProviderUsed: string;
  evidenceProviders: string[];
  evidenceProgress: string;
  allowFallback: boolean;
  streamProgress: string;
};

const SAVED_DRAFT_KEY = "neurotext-saved-generation";
const FUNCTION_WORKSPACES_KEY = "neurotext-function-workspaces";
const DEFAULT_FUNCTION_ONE_INSTRUCTIONS = "Turn the source material into a rigorous 5,000-word scholarly essay, replete with relevant legitimate scholarly studies and evidence. Include supported APA-style in-text citations and a complete APA 7 References bibliography. Do not invent sources, quotations, findings, authors, titles, dates, or publication details.";
const DEFAULT_FUNCTION_ONE_TARGET_WORDS = "5000";
const DEFAULT_THESIS_TARGET_WORDS = "25000";
const DEFAULT_DISSERTATION_TARGET_WORDS = "50000";

function defaultTargetWords(functionId: string) {
  if (functionId === "manipulator") return DEFAULT_FUNCTION_ONE_TARGET_WORDS;
  if (functionId === "thesis") return DEFAULT_THESIS_TARGET_WORDS;
  if (functionId === "dissertation") return DEFAULT_DISSERTATION_TARGET_WORDS;
  return "";
}
const DIAGNOSTIC_SOURCE = `Most people, including most psychologists, operate on the assumption that group psychology is to be understood in terms of individual psychology; that individuals have various self-directed drives and that, in group-contexts, these drives are somehow diverted away from their normal paths and pressed into aims that, not being self-directed, are alien to their own.

This position is understandable, and is at least descriptively correct, where very basic drives are concerned—divines relating to immediate threats to one’s survival and to the prospect of immediate carnal gratification.

But this methodological stance cannot be reconciled with the incredibly high degree of conformism exhibited by people, even after intellectual shortcomings on their part are taken into account, to other people’s opinions; nor can it be reconciled, even after people’s fear of others is taken into account, with the deference given by people, at the expense of their own gratification, to convention and to pre-existing custom, as well as fleeting but powerful fads.

Also, given how unintelligent, ignorant, and lacking in moral fiber most individuals are, and yet how much intelligence, knowledge, and moral rigor is embodied in the behavior of collectives, such as corporations and academic disciplines, it is hard to believe that such collectives are the result of various bona fide individuals pursuing their respective paths. It seems rather as though the collective is the primary thing, biologically speaking, and there is an illusion of individual choice and, indeed, of individualism per se.

A cell is an individual organism. But how well can you understand a cell if you try to understand on its own terms? Pretty well but not maximally well. If you tried to understand its behavior in terms of a drive on its part to live or flourish or reproduce, you would get far; but there would still be some unanswered, and unanswerable, questions.

But suppose you tried to understand individual cells in the following way. They individualy try to survive, flourish and reproduce to the extent---but only to the extent--that their trying to do so is necessary for the collectives formed thereby to survive and flourish and reproduce. In that case, I would suggest, you will get at least as far as you did with your other hypothesis, and probably further. Cell-individualism can be explained in terms of cell collectivism, but not so much vice versa.

Similarly, person-individualism can be explained in terms of person-collectivism, but not so much vice versa. Bona fide individuals—people who think for themselves: geniuses, in other words---can be seen as limiting cases of collectives; as collectives of one, perhaps, or as rogue actors; or, most likely, as members of collectives who have an unusual office within that collective and are therefore seen, wrongly, as not being a part of those collectives. And the intense drives that individuals have to survive and experience gratification can be seen as being necessary for the existence for, and therefore explainable in terms of, the collectives to which they belong. Thus, the facts relating to individual psychology can be reconciled with the view that group psychology is primary.

But the opposite seems not to be true. It is very hard to explain group behavior—be the group in question a mere mob or an organized anti-mob, such as an advanced culture---on the assumption that these collectives represent averages of the behaviors of so many armies of one—of so many self-contained existentialist autonomous deciders. Outside of contexts where there are well-defined and immediate threats to physical well being or where there equally well defined prospects of crude forms of gratification---outside of such context, people are predisposed to give far too much weight, and in far too well-defined ways, to existing beliefs and mores than can be accounted for in terms of the hypothesis that collectives are indeed collectives of bona fide individuals.`;

function emptyFunctionWorkspace(): FunctionWorkspace {
  return {
    text: "",
    instructions: "",
    targetWords: "",
    model: "ZHI 1",
    thinker: "",
    quotes: 0,
    output: "",
    skeleton: "",
    score: null,
    coherenceMode: "autodetect",
    coherenceScorecard: null,
    coherenceProviderUsed: "",
    skeletonProviderUsed: "",
    evidenceProviders: [],
    evidenceProgress: "",
    allowFallback: true,
    streamProgress: "",
  };
}

function functionOneWorkspace(workspace?: FunctionWorkspace): FunctionWorkspace {
  const base = workspace ?? emptyFunctionWorkspace();
  return {
    ...base,
    instructions: base.instructions.trim() || DEFAULT_FUNCTION_ONE_INSTRUCTIONS,
    targetWords: base.targetWords.trim() || DEFAULT_FUNCTION_ONE_TARGET_WORDS,
  };
}

function loadFunctionWorkspaces() {
  try {
    const saved = localStorage.getItem(FUNCTION_WORKSPACES_KEY);
    return saved ? JSON.parse(saved) as Record<string, FunctionWorkspace> : {};
  } catch {
    return {};
  }
}

const portals: Portal[] = [
  { id: "manipulator", number: "01", title: "Document Creator & Manipulator", description: "Write a new document from scratch or transform source material into exactly what you need.", placeholder: "Optional: paste or upload source material. Leave this empty to write entirely from your instructions.", action: "Create or transform document" },
  { id: "objections", number: "02", title: "Objections & Bullet-Proof Rewrite", description: "Find serious objections, answer them, and harden the argument.", placeholder: "Paste the argument or upload the document to stress-test.", action: "Generate objections" },
  { id: "screenplay", number: "03", title: "Screenplay Generator", description: "Generate a screenplay from scratch or revise one from source material.", placeholder: "Optional: paste a story, outline, or screenplay. Leave empty to create from instructions alone.", action: "Generate screenplay" },
  { id: "dialogue", number: "04", title: "Dialogue Generation", description: "Create dialogue from scratch or rework existing spoken material.", placeholder: "Optional: paste a scene, characters, or story context. Leave empty to create from instructions alone.", action: "Generate dialogue" },
  { id: "coherence", number: "05", title: "Coherence Evaluator", description: "Audit and reconstruct long documents using the Skeleton + Tractatus architecture.", placeholder: "Paste or upload the document to evaluate for cross-chunk coherence.", action: "Run coherence evaluation" },
  { id: "maxintel", number: "06", title: "Maximum Intelligence Rewriter", description: "Strengthen reasoning, structure, precision, and intellectual quality.", placeholder: "Paste the draft you want improved.", action: "Rewrite for intelligence" },
  { id: "profile", number: "07", title: "Cognitive Profiling", description: "Extract a cognitive profile from uploaded writing.", placeholder: "Paste representative writing from the author.", action: "Build cognitive profile" },
  { id: "thesis", number: "08", title: "Master’s Thesis Creator", description: "Create a coherent scholarly master’s thesis from instructions alone or supplied research.", placeholder: "Optional: paste research notes, sources, a proposal, or a draft. Leave empty to create from instructions alone.", action: "Create master’s thesis" },
  { id: "dissertation", number: "09", title: "Dissertation Creator", description: "Create a coherent scholarly dissertation from instructions alone or supplied research.", placeholder: "Optional: paste research, an outline, source notes, or a draft. Leave empty to create from instructions alone.", action: "Create dissertation" },
  { id: "translation", number: "10", title: "Document Translation", description: "Translate documents while preserving structure and meaning.", placeholder: "Paste or upload the document you want translated.", action: "Translate document" },
];

const models = ["ZHI 1", "ZHI 2", "ZHI 3", "ZHI 4", "ZHI 5", "ZHI 6"];
const presets = ["Turn into a pitch", "Turn into a pitch with objections", "Turn into a screenplay", "Turn into a master's thesis"];
const coherenceModes = [
  { value: "autodetect", label: "Autodetect" },
  { value: "logical", label: "Logical" },
  { value: "mathematical", label: "Mathematical" },
  { value: "persuasive", label: "Persuasive" },
  { value: "scientific", label: "Scientific" },
  { value: "philosophical", label: "Philosophical" },
  { value: "structural", label: "Structural" },
  { value: "narrative", label: "Narrative" },
  { value: "legal", label: "Legal" },
  { value: "technical", label: "Technical" },
];
const thinkers = [
  "Kuczynski", "Adler", "Aesop", "James Allen", "Aristotle", "Bacon", "Bergler",
  "Bergson", "Berkeley", "Le Bon", "Confucius", "Darwin", "Descartes", "Dewey",
  "Andrea Dworkin", "Engels", "Freud", "Galileo", "Gardner", "Goldman", "Hegel",
  "Hobbes", "Hume", "James", "Jung", "Kant", "Kernberg", "Laplace", "Leibniz",
  "Locke", "Luther", "Machiavelli", "Maimonides", "Marden", "Marx", "Mill",
  "Nietzsche", "Peirce", "Plato", "Poincaré", "Popper", "La Rochefoucauld",
  "Rousseau", "Russell", "Sartre", "Schopenhauer", "Smith", "Spencer", "Stekel",
  "Tocqueville", "Veblen", "Weyl", "William Whewell",
];

function api(path: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${base}/api${path}`;
}

function stripInternalGenerationArtifacts(text: string) {
  return text
    .split(/\n\s*\n/)
    .filter((paragraph) => {
      const normalized = paragraph.trim();
      if (!normalized) return true;
      if (/^(?:CONFLICT_FLAG|ANTI-SYCOPHANCY CONTRACT|VERIFIED SCHOLARLY METADATA|PERMITTED CITATION|OPENING BLOCK(?: INSTRUCTION)?|GLOBAL SKELETON)\s*:/i.test(normalized)) return false;
      if (/\bPERMITTED CITATION\b/i.test(normalized) && /\b(?:metadata|instruction|contract)\b/i.test(normalized)) return false;
      return true;
    })
    .join("\n\n")
    .replace(/\bCONFLICT_FLAG\s*:\s*/gi, "")
    .trim();
}

function cleanDocumentText(text: string) {
  return stripInternalGenerationArtifacts(text)
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function countWords(text: string) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function cleanCoherenceText(text: string) {
  return text
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function parseCoherenceScorecard(text: string, fallbackMode: string): CoherenceScorecard | null {
  const scoreMatch = text.match(/OVERALL\s+SCORE\s*:\s*(\d{1,3})\s*(?:\/\s*100)?/i);
  const verdictMatch = text.match(/VERDICT\s*:\s*([^\n]+)/i);
  const modeMatch = text.match(/^MODE\s*:\s*([^\n]+)/im);
  const dimensions: CoherenceDimension[] = [];
  let readingDimensions = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^DIMENSIONS\s*:\s*$/i.test(line)) {
      readingDimensions = true;
      continue;
    }
    if (readingDimensions && /^[A-Z][A-Z /&-]{2,}:\s*$/.test(line)) break;
    if (!readingDimensions) continue;
    const match = line.match(/^(?:[-•]\s*)?(.+?)\s*:\s*(\d{1,3})\s*(?:\/\s*100)?\s*[—–-]\s*(.+)$/);
    if (match) {
      dimensions.push({
        label: match[1].trim(),
        score: Math.max(0, Math.min(100, Number(match[2]))),
        note: match[3].trim(),
      });
    }
  }
  if (!scoreMatch && !verdictMatch && dimensions.length === 0) return null;
  return {
    mode: modeMatch?.[1]?.trim() ?? coherenceModes.find((item) => item.value === fallbackMode)?.label ?? fallbackMode,
    score: scoreMatch ? Math.max(0, Math.min(100, Number(scoreMatch[1]))) : null,
    verdict: verdictMatch?.[1]?.trim() ?? "",
    dimensions,
  };
}

function CoherenceScorecardPanel({
  scorecard,
  requestedProvider,
  evidenceProviders,
  skeletonProviderUsed,
  auditProviderUsed,
  busy,
}: {
  scorecard: CoherenceScorecard | null;
  requestedProvider: string;
  evidenceProviders: string[];
  skeletonProviderUsed: string;
  auditProviderUsed: string;
  busy: boolean;
}) {
  const score = scorecard?.score;
  return (
    <section className="rounded-lg border border-[#b8cff1] bg-[#f2f7ff] p-4 sm:p-5" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.14em] text-[#1e64c8]">Coherence score</p>
          <p className="mt-1 text-4xl font-bold tracking-tight text-[#12223a]">
            {typeof score === "number" ? score : "—"}<span className="ml-1 text-base font-semibold text-[#56647a]">/100</span>
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#33455f]">
            {scorecard?.verdict || (busy ? "Extracting the document structure and classifying coherence…" : "No score was returned for this evaluation.")}
          </p>
        </div>
        <div className="min-w-[190px] space-y-1.5 rounded-md border border-[#d4e2f5] bg-white px-3 py-2.5 text-xs leading-5 text-[#46566e]">
          <p><span className="font-semibold text-[#223750]">Mode:</span> {scorecard?.mode ?? "Preparing"}</p>
          <p><span className="font-semibold text-[#223750]">Requested:</span> {requestedProvider}</p>
          <p><span className="font-semibold text-[#223750]">Structure:</span> {skeletonProviderUsed || (busy ? "Connecting…" : "Unavailable")}</p>
          <p><span className="font-semibold text-[#223750]">Audit:</span> {auditProviderUsed || (busy ? "Connecting…" : "Unavailable")}</p>
          {evidenceProviders.length > 0 && <p><span className="font-semibold text-[#223750]">Indexing:</span> {evidenceProviders.join(", ")}</p>}
        </div>
      </div>
      {scorecard?.dimensions && scorecard.dimensions.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {scorecard.dimensions.map((dimension) => (
            <div key={dimension.label} className="rounded-md border border-[#dce7f6] bg-white px-3 py-2.5">
              <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-[#223750]">{dimension.label}</span><span className="text-sm font-bold text-[#1e64c8]">{dimension.score}/100</span></div>
              <p className="mt-1 text-xs leading-5 text-[#56647a]">{dimension.note}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

async function consumeStream(
  response: Response,
  onEvent: (event: Record<string, unknown>) => void,
) {
  if (!response.ok || !response.body) throw new Error();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith(":")) continue;
      const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
      if (payload) onEvent(JSON.parse(payload));
    }
    if (done) break;
  }
  const finalPayload = buffer.trim();
  if (finalPayload && !finalPayload.startsWith(":")) {
    onEvent(JSON.parse(finalPayload.startsWith("data:") ? finalPayload.slice(5).trim() : finalPayload));
  }
}

export default function Neurotext({ user, onLogout, loginUrl, diagnosticsOnly = false }: { user: AuthUser | null; onLogout: () => void | Promise<void>; loginUrl: string; diagnosticsOnly?: boolean }) {
  const isDevelopmentOwner = user?.id === "development-owner";
  const isPermanentOwner = isDevelopmentOwner || user?.email.trim().toLowerCase() === "johnmichaelkuczynski@gmail.com";
  const functionWorkspaces = useRef<Record<string, FunctionWorkspace>>(loadFunctionWorkspaces());
  const initialWorkspace = useRef(functionOneWorkspace(functionWorkspaces.current[portals[0].id])).current;
  const [active, setActive] = useState(portals[0].id);
  const portal = useMemo(() => portals.find((item) => item.id === active) ?? portals[0], [active]);
  const [text, setText] = useState(initialWorkspace.text);
  const [instructions, setInstructions] = useState(initialWorkspace.instructions);
  const [targetWords, setTargetWords] = useState(initialWorkspace.targetWords);
  const [functionOnePreset, setFunctionOnePreset] = useState("");
  const [model, setModel] = useState(initialWorkspace.model);
  const [thinker, setThinker] = useState(initialWorkspace.thinker);
  const [quotes, setQuotes] = useState(initialWorkspace.quotes);
  const [output, setOutput] = useState(initialWorkspace.output);
  const [skeleton, setSkeleton] = useState(initialWorkspace.skeleton);
  const [score, setScore] = useState<number | null>(initialWorkspace.score);
  const [coherenceMode, setCoherenceMode] = useState(initialWorkspace.coherenceMode);
  const [coherenceScorecard, setCoherenceScorecard] = useState<CoherenceScorecard | null>(initialWorkspace.coherenceScorecard);
  const [coherenceImproved, setCoherenceImproved] = useState(false);
  const [coherenceProviderUsed, setCoherenceProviderUsed] = useState(initialWorkspace.coherenceProviderUsed);
  const [skeletonProviderUsed, setSkeletonProviderUsed] = useState(initialWorkspace.skeletonProviderUsed);
  const [evidenceProviders, setEvidenceProviders] = useState<string[]>(initialWorkspace.evidenceProviders);
  const [evidenceProgress, setEvidenceProgress] = useState(initialWorkspace.evidenceProgress);
  const [allowFallback, setAllowFallback] = useState(initialWorkspace.allowFallback);
  const [copiedOutput, setCopiedOutput] = useState(false);
  const [busy, setBusy] = useState(false);
  const [streamProgress, setStreamProgress] = useState(initialWorkspace.streamProgress);
  const [showStreamModal, setShowStreamModal] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticResult[]>([]);
  const [diagnosticModel, setDiagnosticModel] = useState(initialWorkspace.model);
  const [diagnosingSecondary, setDiagnosingSecondary] = useState(false);
  const [secondaryDiagnostics, setSecondaryDiagnostics] = useState<DiagnosticResult[]>([]);
  const [secondaryDiagnosticModel, setSecondaryDiagnosticModel] = useState(initialWorkspace.model);
  const [selectedDiagnosticThesis, setSelectedDiagnosticThesis] = useState("");
  const [diagnosingFiftyK, setDiagnosingFiftyK] = useState(false);
  const [fiftyKDiagnostics, setFiftyKDiagnostics] = useState<DiagnosticResult[]>([]);
  const [fiftyKDiagnosticModel, setFiftyKDiagnosticModel] = useState(initialWorkspace.model);
  const [selectedFiftyKThesis, setSelectedFiftyKThesis] = useState("");
  const [visitorCount, setVisitorCount] = useState<number | null>(null);
  const [aiDetection, setAiDetection] = useState<AiDetection | null>(null);
  const [aiDetecting, setAiDetecting] = useState(false);
  const [aiDetectionError, setAiDetectionError] = useState("");
  const [freeUsage, setFreeUsage] = useState<FreeUsage | null>(null);
  const [runFailed, setRunFailed] = useState(false);
  const [billingActive, setBillingActive] = useState(false);

  useEffect(() => {
    if (active === "manipulator" && !instructions.trim()) setInstructions(DEFAULT_FUNCTION_ONE_INSTRUCTIONS);
    const automaticTarget = defaultTargetWords(active);
    if (automaticTarget && !targetWords.trim()) setTargetWords(automaticTarget);
  }, [active]);
  const [latestPayment, setLatestPayment] = useState<BillingPayment | null>(null);
  const [subscriptionPlan, setSubscriptionPlan] = useState<SubscriptionPlan | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const aiDetectionAbort = useRef<AbortController | null>(null);
  const streamAbort = useRef<AbortController | null>(null);
  const diagnosticLock = useRef(false);
  const outputRef = useRef("");
  const outputPaintFrame = useRef<number | null>(null);
  const skeletonRef = useRef("");
  const streamedBlocks = useRef(new Set<number>());
  const [savedDraft, setSavedDraft] = useState<SavedDraft | null>(() => {
    try {
      const saved = localStorage.getItem(SAVED_DRAFT_KEY);
      return saved ? JSON.parse(saved) as SavedDraft : null;
    } catch {
      return null;
    }
  });
  const wordCount = useMemo(() => countWords(text), [text]);
  const nextPortal = useMemo(() => {
    const currentIndex = portals.findIndex((item) => item.id === active);
    return portals[(currentIndex + 1) % portals.length];
  }, [active]);
  const sourceRequired = ["objections", "coherence", "maxintel", "profile", "translation"].includes(active);
  const canRun = sourceRequired ? Boolean(text.trim()) : Boolean(text.trim() || instructions.trim());

  useEffect(() => {
    outputRef.current = output;
  }, [output]);

  useEffect(() => {
    skeletonRef.current = skeleton;
  }, [skeleton]);

  const refreshFreeUsage = () => {
    fetch(api("/auth/usage"), { credentials: "include" })
      .then((response) => response.ok ? response.json() as Promise<FreeUsage> : Promise.reject())
      .then(setFreeUsage)
      .catch(() => setFreeUsage(null));
  };

  useEffect(() => {
    refreshFreeUsage();
    fetch(api("/stripe/status"), { credentials: "include" })
      .then((response) => response.ok ? response.json() as Promise<{ active?: boolean; latestPayment?: BillingPayment | null }> : Promise.reject())
      .then((status) => {
        setBillingActive(Boolean(status.active));
        setLatestPayment(status.latestPayment ?? null);
      })
      .catch(() => setBillingActive(false));
    fetch(api("/stripe/plan"), { credentials: "include" })
      .then((response) => response.ok ? response.json() as Promise<SubscriptionPlan> : Promise.reject())
      .then(setSubscriptionPlan)
      .catch(() => setSubscriptionPlan(null));
  }, [user?.id]);

  const startSubscription = async () => {
    setCheckoutBusy(true);
    try {
      const response = await fetch(api("/stripe/checkout"), { method: "POST", credentials: "include" });
      const data = await response.json() as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || "Checkout could not be opened.");
      window.location.assign(data.url);
    } catch (error) {
      setRunFailed(true);
      setStreamProgress(error instanceof Error ? error.message : "Checkout could not be opened.");
    } finally {
      setCheckoutBusy(false);
    }
  };

  const openBillingPortal = async () => {
    try {
      const response = await fetch(api("/stripe/portal"), { method: "POST", credentials: "include" });
      const data = await response.json() as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || "Billing management could not be opened.");
      window.location.assign(data.url);
    } catch (error) {
      setRunFailed(true);
      setStreamProgress(error instanceof Error ? error.message : "Billing management could not be opened.");
    }
  };

  const startAgain = () => {
    streamAbort.current?.abort();
    aiDetectionAbort.current?.abort();
    localStorage.removeItem(FUNCTION_WORKSPACES_KEY);
    localStorage.removeItem(SAVED_DRAFT_KEY);
    window.location.reload();
  };

  const commitOutput = (update: string | ((current: string) => string)) => {
    const next = typeof update === "function" ? update(outputRef.current) : update;
    outputRef.current = next;
    if (outputPaintFrame.current !== null) {
      window.cancelAnimationFrame(outputPaintFrame.current);
      outputPaintFrame.current = null;
    }
    setOutput(next);
  };

  const appendStreamingOutput = (token: string) => {
    outputRef.current += token;
    if (outputPaintFrame.current !== null) return;
    outputPaintFrame.current = window.requestAnimationFrame(() => {
      outputPaintFrame.current = null;
      setOutput(outputRef.current);
    });
  };

  const currentWorkspace = (overrides?: Partial<FunctionWorkspace>): FunctionWorkspace => ({
    text,
    instructions,
    targetWords,
    model,
    thinker,
    quotes,
    output: outputRef.current,
    skeleton: skeletonRef.current,
    score,
    coherenceMode,
    coherenceScorecard,
    coherenceProviderUsed,
    skeletonProviderUsed,
    evidenceProviders,
    evidenceProgress,
    allowFallback,
    streamProgress,
    ...overrides,
  });

  const persistWorkspace = (functionId: string, workspace: FunctionWorkspace) => {
    functionWorkspaces.current = { ...functionWorkspaces.current, [functionId]: workspace };
    localStorage.setItem(FUNCTION_WORKSPACES_KEY, JSON.stringify(functionWorkspaces.current));
  };

  const restoreWorkspace = (workspace: FunctionWorkspace) => {
    setText(workspace.text);
    setInstructions(workspace.instructions);
    setTargetWords(workspace.targetWords);
    setModel(workspace.model);
    setThinker(workspace.thinker);
    setQuotes(workspace.quotes);
    commitOutput(workspace.output);
    skeletonRef.current = workspace.skeleton;
    setSkeleton(workspace.skeleton);
    setScore(workspace.score);
    setCoherenceMode(workspace.coherenceMode);
    setCoherenceScorecard(workspace.coherenceScorecard);
    setCoherenceProviderUsed(workspace.coherenceProviderUsed);
    setSkeletonProviderUsed(workspace.skeletonProviderUsed);
    setEvidenceProviders(workspace.evidenceProviders);
    setEvidenceProgress(workspace.evidenceProgress);
    setAllowFallback(workspace.allowFallback);
    setStreamProgress(workspace.streamProgress);
    setCopiedOutput(false);
    setShowStreamModal(false);
    setDiagnostics([]);
    setAiDetection(null);
    setAiDetectionError("");
    setAiDetecting(false);
    setRunFailed(false);
  };

  const switchFunction = (destinationId: string, incomingDocument?: string) => {
    if (busy || destinationId === active) return;
    persistWorkspace(active, currentWorkspace());
    const destination = destinationId === "manipulator"
      ? functionOneWorkspace(functionWorkspaces.current[destinationId])
      : functionWorkspaces.current[destinationId] ?? emptyFunctionWorkspace();
    const nextWorkspace = incomingDocument === undefined
      ? destination
      : { ...destination, text: incomingDocument, output: "", skeleton: "", score: null, coherenceScorecard: null, streamProgress: "" };
    persistWorkspace(destinationId, nextWorkspace);
    setActive(destinationId);
    restoreWorkspace(nextWorkspace);
  };

  useEffect(() => {
    const saved = localStorage.getItem("neurotext-visitor") ?? crypto.randomUUID();
    localStorage.setItem("neurotext-visitor", saved);
    fetch(api("/visitors/register"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visitorId: saved }) })
      .then((response) => response.json())
      .then((data) => setVisitorCount(data.count))
      .catch(() => setVisitorCount(null));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => persistWorkspace(active, currentWorkspace()), 250);
    return () => window.clearTimeout(timer);
  }, [active, text, instructions, targetWords, model, thinker, quotes, output, skeleton, score, coherenceMode, coherenceScorecard, coherenceProviderUsed, skeletonProviderUsed, evidenceProviders, evidenceProgress, allowFallback, streamProgress]);

  useEffect(() => {
    aiDetectionAbort.current?.abort();
    const source = text.trim();
    if (!source) {
      setAiDetection(null);
      setAiDetectionError("");
      setAiDetecting(false);
      return;
    }

    const controller = new AbortController();
    aiDetectionAbort.current = controller;
    setAiDetecting(true);
    setAiDetectionError("");
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(api("/ai-detect"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ text: source, provider: model }),
        });
        const data = await response.json() as Partial<AiDetection> & { error?: string };
        if (!response.ok) throw new Error(data.error || "The AI detector could not complete.");
        if (controller.signal.aborted) return;
        setAiDetection({
          aiProbability: Math.max(0, Math.min(100, Math.round(Number(data.aiProbability) || 0))),
          label: typeof data.label === "string" ? data.label : "Estimate unavailable",
          explanation: typeof data.explanation === "string" ? data.explanation : "This estimate is based on observable writing patterns and is not definitive.",
          providerUsed: typeof data.providerUsed === "string" ? data.providerUsed : model,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setAiDetection(null);
        setAiDetectionError(error instanceof Error ? error.message : "The AI detector could not complete.");
      } finally {
        if (!controller.signal.aborted) setAiDetecting(false);
      }
    }, 850);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [model, text]);

  const loadFile = async (file?: File) => {
    if (!file) return;
    if (file.type.startsWith("image/")) {
      setText("Extracting text from image…");
      try {
        const imageData = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const response = await fetch(api("/ocr"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageData }),
        });
        const data = await response.json();
        if (!response.ok || !data.text) throw new Error();
        setText(data.text);
      } catch {
        setText("Text extraction could not complete for this image. Please try another image or paste its text.");
      }
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const run = async (options?: { resume?: boolean }) => {
    const resumable = options?.resume && savedDraft?.active === active ? savedDraft : null;
    const sourceText = resumable?.text ?? text;
    const storedInstructions = resumable?.instructions ?? instructions;
    const storedTargetWords = resumable?.targetWords ?? targetWords;
    const sourceInstructions = active === "manipulator" && !storedInstructions.trim()
      ? DEFAULT_FUNCTION_ONE_INSTRUCTIONS
      : storedInstructions;
    const sourceTargetWords = !storedTargetWords.trim() && defaultTargetWords(active)
      ? defaultTargetWords(active)
      : storedTargetWords;
    const sourceModel = resumable?.model ?? model;
    const sourceThinker = resumable?.thinker ?? thinker;
    const sourceQuotes = resumable?.quotes ?? quotes;
    if (sourceRequired ? !sourceText.trim() : !sourceText.trim() && !sourceInstructions.trim()) return;
    const controller = new AbortController();
    streamAbort.current = controller;
    streamedBlocks.current.clear();
    if (resumable) {
      setText(sourceText);
      setInstructions(sourceInstructions);
      setTargetWords(sourceTargetWords);
      setModel(sourceModel);
      setThinker(sourceThinker);
      setQuotes(sourceQuotes);
      commitOutput(resumable.output);
      setSkeleton(resumable.skeleton);
      outputRef.current = resumable.output;
      skeletonRef.current = resumable.skeleton;
    }
    setBusy(true);
    setRunFailed(false);
    setShowStreamModal(true);
    if (!resumable) {
      commitOutput("");
      setSkeleton("");
      outputRef.current = "";
      skeletonRef.current = "";
    }
    setStreamProgress(resumable ? `Resuming from ${countWords(resumable.output).toLocaleString()} saved words…` : portal.id === "coherence" ? "Preparing coherence analysis…" : "Preparing the first streamed section…");
    try {
      if (portal.id === "coherence") {
        setCoherenceImproved(false);
        setSkeleton("");
        setScore(null);
        setCoherenceProviderUsed("");
        setSkeletonProviderUsed("");
        setEvidenceProviders([]);
        setEvidenceProgress("");
        setCopiedOutput(false);
        setCoherenceScorecard({
          mode: coherenceModes.find((item) => item.value === coherenceMode)?.label ?? coherenceMode,
          score: null,
          verdict: "Extracting the document structure and classifying coherence…",
          dimensions: [],
        });
        const response = await fetch(api("/coherence/stream"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ title: "Coherence evaluation", text: sourceText, instructions: sourceInstructions, targetWords: sourceTargetWords, provider: sourceModel, mode: coherenceMode, allowFallback, thinker: sourceThinker, quotes: sourceQuotes }),
        });
        if (response.status === 402) {
          const denial = await response.json() as { message?: string; usage?: FreeUsage };
          if (denial.usage) setFreeUsage(denial.usage);
          throw new Error(denial.message || "Your free allowance has been used.");
        }
        await consumeStream(response, (event) => {
          if (event.type === "skeleton_token") {
            if (typeof event.providerUsed === "string") setSkeletonProviderUsed(event.providerUsed);
            setSkeleton((current) => current + String(event.text ?? ""));
          }
          if (event.type === "skeleton") {
            if (typeof event.providerUsed === "string") setSkeletonProviderUsed(event.providerUsed);
            setSkeleton(cleanDocumentText(String(event.text ?? "")));
          }
          if (event.type === "token") {
            if (typeof event.providerUsed === "string") setCoherenceProviderUsed(event.providerUsed);
            appendStreamingOutput(String(event.text ?? ""));
          }
          if (event.type === "replace_output" && typeof event.text === "string") commitOutput(event.text);
          if (event.type === "evidence_token") {
            if (typeof event.providerUsed === "string") setEvidenceProviders((current) => current.includes(event.providerUsed as string) ? current : [...current, event.providerUsed as string]);
            const index = typeof event.index === "number" ? event.index + 1 : null;
            const total = typeof event.total === "number" ? event.total : null;
            if (index && total) setEvidenceProgress(`Indexing long document: section ${index} of ${total}`);
          }
          if (event.type === "done") {
            setScore(typeof event.coherenceScore === "number" ? event.coherenceScore : null);
            if (typeof event.providerUsed === "string") setCoherenceProviderUsed(event.providerUsed);
            const usage = event.providerUsage;
            if (usage && typeof usage === "object" && !Array.isArray(usage)) {
              const value = usage as Record<string, unknown>;
              if (Array.isArray(value.evidence)) setEvidenceProviders(value.evidence.filter((item): item is string => typeof item === "string"));
              if (Array.isArray(value.skeleton) && typeof value.skeleton[0] === "string") setSkeletonProviderUsed(value.skeleton[0]);
              if (Array.isArray(value.audit) && typeof value.audit[0] === "string") setCoherenceProviderUsed(value.audit[0]);
            }
            const card = event.scorecard;
            if (
              card
              && typeof card === "object"
              && !Array.isArray(card)
              && typeof (card as Record<string, unknown>).mode === "string"
              && typeof (card as Record<string, unknown>).verdict === "string"
              && Array.isArray((card as Record<string, unknown>).dimensions)
            ) {
              const value = card as Record<string, unknown>;
              setCoherenceScorecard({
                mode: String(value.mode),
                score: typeof value.score === "number" ? value.score : null,
                verdict: String(value.verdict),
                dimensions: (value.dimensions as Array<Record<string, unknown>>)
                  .filter((item) => typeof item.label === "string" && typeof item.score === "number" && typeof item.note === "string")
                  .map((item) => ({ label: String(item.label), score: Number(item.score), note: String(item.note) })),
              });
            }
          }
          if (event.type === "error") throw new Error();
        });
      } else {
        let documentStreamCompleted = false;
        const response = await fetch(api("/functions/stream"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            functionId: portal.id,
            text: sourceText,
            instructions: sourceInstructions,
            targetWords: sourceTargetWords,
            provider: sourceModel,
            thinker: sourceThinker,
            quotes: sourceQuotes,
            resumeDocument: resumable?.output,
            resumeSkeleton: resumable?.skeleton,
          }),
        });
        if (response.status === 402) {
          const denial = await response.json() as { message?: string; usage?: FreeUsage };
          if (denial.usage) setFreeUsage(denial.usage);
          throw new Error(denial.message || "Your free allowance has been used.");
        }
        await consumeStream(response, (event) => {
          if (event.type === "skeleton_token") {
            const token = String(event.text ?? "");
            skeletonRef.current += token;
            setSkeleton(skeletonRef.current);
            setStreamProgress("Writing the global outline live…");
          }
          if (event.type === "plan_start") {
            const target = typeof event.targetWords === "number" ? event.targetWords.toLocaleString() : targetWords;
            setStreamProgress(`Extracting an immutable global skeleton for ${target} words…`);
          }
          if (event.type === "plan_ready") {
            const total = typeof event.total === "number" ? event.total : 1;
            if (typeof event.skeleton === "string") {
              skeletonRef.current = event.skeleton;
              setSkeleton(event.skeleton);
            }
            setStreamProgress(`Global skeleton ready · preparing block 1 of ${total}`);
          }
          if (event.type === "resume_ready") {
            const generatedWords = typeof event.generatedWords === "number" ? event.generatedWords.toLocaleString() : countWords(outputRef.current).toLocaleString();
            setStreamProgress(`Saved draft restored · continuing after ${generatedWords} words`);
          }
          if (event.type === "block_repair") {
            const index = typeof event.index === "number" ? event.index + 1 : 1;
            setStreamProgress(`Expanding short block ${index} to its required length…`);
          }
          if (event.type === "section_start") {
            const index = typeof event.index === "number" ? event.index : 0;
            streamedBlocks.current.delete(index);
            commitOutput((current) => current ? `${current}\n\n` : "");
          }
          if (event.type === "section_start") {
            const index = typeof event.index === "number" ? event.index + 1 : 1;
            const total = typeof event.total === "number" ? event.total : 1;
            const generatedWords = typeof event.generatedWords === "number" ? ` · ${event.generatedWords.toLocaleString()} words written` : "";
            setStreamProgress(`Generating block ${index} of ${total} · up to 200 words${generatedWords}`);
          }
          if (event.type === "token") {
            const blockIndex = typeof event.index === "number" ? event.index : 0;
            streamedBlocks.current.add(blockIndex);
            appendStreamingOutput(String(event.text ?? ""));
            const index = typeof event.index === "number" ? event.index + 1 : 1;
            const total = typeof event.total === "number" ? event.total : 1;
            setStreamProgress(`Streaming block ${index} of ${total}`);
          }
          if (event.type === "section_done") {
            const index = typeof event.index === "number" ? event.index + 1 : 1;
            const zeroBasedIndex = index - 1;
            if (!streamedBlocks.current.has(zeroBasedIndex) && typeof event.text === "string" && event.text.trim()) {
              commitOutput((current) => current + event.text);
            }
            const total = typeof event.total === "number" ? event.total : 1;
            const generatedWords = typeof event.generatedWords === "number" ? event.generatedWords.toLocaleString() : "";
            const target = typeof event.targetWords === "number" ? event.targetWords.toLocaleString() : "";
            setStreamProgress(index < total ? `Block ${index} complete · ${generatedWords}${target ? ` of ${target}` : ""} words · preparing block ${index + 1}` : `Final block complete · ${generatedWords}${target ? ` of ${target}` : ""} words`);
          }
          if (event.type === "rest_start") {
            const seconds = typeof event.durationMs === "number" ? Math.round(event.durationMs / 1000) : 3;
            const milestone = typeof event.milestoneWords === "number" ? event.milestoneWords.toLocaleString() : "";
            setStreamProgress(`Resting ${seconds} seconds after ${milestone} words to protect the long-form run…`);
          }
          if (event.type === "rest_done") setStreamProgress("Rest complete · preparing the next block");
          if (event.type === "done") {
            documentStreamCompleted = true;
            const generatedWords = typeof event.generatedWords === "number" ? event.generatedWords.toLocaleString() : "";
            setStreamProgress(generatedWords ? `Complete · ${generatedWords} words` : "All blocks complete");
          }
          if (event.type === "validation_start") setStreamProgress("Running the global coherence stitch…");
          if (event.type === "replace_output" && typeof event.text === "string") commitOutput(event.text);
          if (event.type === "validation_done") {
            const repairs = typeof event.repairs === "number" ? event.repairs : 0;
            setStreamProgress(repairs > 0 ? `Global coherence stitch complete · ${repairs} local repairs applied` : "Global coherence stitch complete");
          }
          if (event.type === "quality_passed") {
            const generatedWords = typeof event.generatedWords === "number" ? event.generatedWords.toLocaleString() : "";
            setStreamProgress(`Quality check passed${generatedWords ? ` · ${generatedWords} words` : ""}`);
          }
          if (event.type === "quality_failed") {
            const failures = Array.isArray(event.failures) ? event.failures.filter((item): item is string => typeof item === "string") : [];
            throw new Error(failures.join(" "));
          }
          if (event.type === "error") throw new Error();
        });
        if (!documentStreamCompleted) {
          throw new Error("The document stream ended before the requested paper completed.");
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (outputRef.current.trim()) {
        const interruptedDraft: SavedDraft = {
          active,
          text: sourceText,
          instructions: sourceInstructions,
          targetWords: sourceTargetWords,
          model: sourceModel,
          thinker: sourceThinker,
          quotes: sourceQuotes,
          output: outputRef.current,
          skeleton: skeletonRef.current,
        };
        localStorage.setItem(SAVED_DRAFT_KEY, JSON.stringify(interruptedDraft));
        setSavedDraft(interruptedDraft);
      }
      const reason = error instanceof Error && error.message ? ` ${error.message}` : "";
      setRunFailed(true);
      setStreamProgress(outputRef.current.trim()
        ? `Interrupted at ${countWords(outputRef.current).toLocaleString()} words.${reason} Resume saved is available.`
        : `This run could not be completed.${reason} Please try again.`);
    } finally {
      if (streamAbort.current === controller) {
        streamAbort.current = null;
        setBusy(false);
        refreshFreeUsage();
      }
    }
  };

  const saveAndStop = () => {
    const draft: SavedDraft = {
      active,
      text,
      instructions,
      targetWords,
      model,
      thinker,
      quotes,
      output: outputRef.current,
      skeleton: skeletonRef.current,
    };
    localStorage.setItem(SAVED_DRAFT_KEY, JSON.stringify(draft));
    setSavedDraft(draft);
    streamAbort.current?.abort();
    setBusy(false);
    setStreamProgress(`Saved and stopped at ${countWords(draft.output).toLocaleString()} words`);
  };

  const streamedScorecard = useMemo(
    () => portal.id === "coherence" ? parseCoherenceScorecard(output, coherenceMode) : null,
    [output, portal.id, coherenceMode],
  );
  const visibleScorecard = useMemo<CoherenceScorecard | null>(() => {
    if (!coherenceScorecard && !streamedScorecard) return null;
    return {
      mode: streamedScorecard?.mode || coherenceScorecard?.mode || coherenceMode,
      score: streamedScorecard?.score ?? coherenceScorecard?.score ?? score,
      verdict: streamedScorecard?.verdict || coherenceScorecard?.verdict || "",
      dimensions: streamedScorecard?.dimensions.length ? streamedScorecard.dimensions : (coherenceScorecard?.dimensions ?? []),
    };
  }, [coherenceMode, coherenceScorecard, score, streamedScorecard]);

  const coherenceReportText = () => [
    "NEUROTEXT COHERENCE EVALUATION",
    `Mode: ${visibleScorecard?.mode ?? coherenceModes.find((item) => item.value === coherenceMode)?.label ?? coherenceMode}`,
    `Score: ${typeof visibleScorecard?.score === "number" ? `${visibleScorecard.score}/100` : "Unavailable"}`,
    `Requested model: ${model}`,
    `Structure model used: ${skeletonProviderUsed || "Unavailable"}`,
    `Audit model used: ${coherenceProviderUsed || "Unavailable"}`,
    evidenceProviders.length ? `Evidence-index models used: ${evidenceProviders.join(", ")}` : "",
    "",
    output.trim(),
    skeleton.trim() ? `\n\nEXTRACTED SKELETON\n${skeleton.trim()}` : "",
  ].join("\n");

  const improveCoherence = async () => {
    if (busy || !text.trim() || !output.trim()) return;
    const sourceDocument = text;
    const auditReport = coherenceReportText();
    const controller = new AbortController();
    streamAbort.current = controller;
    streamedBlocks.current.clear();
    setBusy(true);
    setRunFailed(false);
    setShowStreamModal(true);
    setStreamProgress("Applying every coherence repair and streaming the revised document…");
    commitOutput("");
    try {
      let documentStreamCompleted = false;
      const response = await fetch(api("/functions/stream"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          functionId: "maxintel",
          text: sourceDocument,
          instructions: `Rewrite the complete source document to improve its coherence. Apply every specific repair identified in the coherence evaluation below, including contradictions, continuity gaps, weak transitions, duplicated reasoning, undefined qualifications, and typographic defects. Preserve the original thesis, substantive claims, genre, characters, citations, quotations, and approximate length. Preserve screenplay scene headings, speaker names, dialogue formatting, and stage directions when the source is a screenplay. Every returned sentence must be complete, grammatical, and readable. Preserve normal word boundaries and punctuation. Do not produce fragments, compressed telegraphic prose, malformed words, commentary about the report, or another evaluation. Silently proofread the entire revision for grammatical integrity before returning it. Return only the fully revised document.\n\nCOHERENCE EVALUATION:\n${auditReport}`,
          targetWords: String(countWords(sourceDocument)),
          provider: model,
          thinker,
          quotes,
        }),
      });
      if (response.status === 402) {
        const denial = await response.json() as { message?: string; usage?: FreeUsage };
        if (denial.usage) setFreeUsage(denial.usage);
        throw new Error(denial.message || "Your free allowance has been used.");
      }
      await consumeStream(response, (event) => {
        if (event.type === "section_start") {
          const index = typeof event.index === "number" ? event.index : 0;
          streamedBlocks.current.delete(index);
          commitOutput((current) => current ? `${current}\n\n` : "");
        }
        if (event.type === "token") {
          const blockIndex = typeof event.index === "number" ? event.index : 0;
          streamedBlocks.current.add(blockIndex);
          appendStreamingOutput(String(event.text ?? ""));
          setStreamProgress("Streaming the coherence-improved document…");
        }
        if (event.type === "section_done") {
          const index = typeof event.index === "number" ? event.index : 0;
          if (!streamedBlocks.current.has(index) && typeof event.text === "string" && event.text.trim()) {
            commitOutput((current) => current + event.text);
          }
        }
        if (event.type === "replace_output" && typeof event.text === "string") commitOutput(event.text);
        if (event.type === "done") {
          documentStreamCompleted = true;
          const generatedWords = typeof event.generatedWords === "number" ? event.generatedWords.toLocaleString() : countWords(outputRef.current).toLocaleString();
          setStreamProgress(`Coherence improved · ${generatedWords} words`);
        }
        if (event.type === "error") throw new Error(String(event.message ?? "The coherence repair could not complete."));
      });
      if (!documentStreamCompleted) throw new Error("The coherence-improved document stream ended before completion.");
      setCoherenceImproved(true);
    } catch (error) {
      if (controller.signal.aborted) return;
      setRunFailed(true);
      const reason = error instanceof Error && error.message ? ` ${error.message}` : "";
      setStreamProgress(outputRef.current.trim()
        ? `Coherence repair interrupted at ${countWords(outputRef.current).toLocaleString()} words.${reason}`
        : `The coherence repair could not complete.${reason}`);
    } finally {
      if (streamAbort.current === controller) {
        streamAbort.current = null;
        setBusy(false);
        refreshFreeUsage();
      }
    }
  };

  const copyCoherenceReport = async () => {
    if (!output.trim() || !navigator.clipboard) return;
    await navigator.clipboard.writeText(coherenceReportText());
    setCopiedOutput(true);
    window.setTimeout(() => setCopiedOutput(false), 1800);
  };

  const downloadCoherenceReport = () => {
    if (!output.trim()) return;
    const blob = new Blob([coherenceReportText()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "neurotext-coherence-evaluation.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  const copyOutput = async () => {
    if (!output.trim() || !navigator.clipboard) return;
    await navigator.clipboard.writeText(cleanDocumentText(output));
    setCopiedOutput(true);
    window.setTimeout(() => setCopiedOutput(false), 1800);
  };

  const downloadOutput = () => {
    if (!output.trim()) return;
    const filename = `${portal.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "neurotext-document"}.txt`;
    const blob = new Blob([cleanDocumentText(output)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const sendOutputToFunction = (destinationId: string) => {
    const documentText = cleanDocumentText(output);
    if (!documentText || busy) return;
    setShowStreamModal(false);
    if (destinationId === active) {
      persistWorkspace(active, currentWorkspace({ text: documentText }));
      setText(documentText);
      setInstructions("");
      setTargetWords("");
      setOutput("");
      setSkeleton("");
      setScore(null);
      setCoherenceScorecard(null);
      setCoherenceProviderUsed("");
      setSkeletonProviderUsed("");
      setEvidenceProviders([]);
      setEvidenceProgress("");
      setCopiedOutput(false);
      setStreamProgress("");
      setDiagnostics([]);
      setAiDetection(null);
      setAiDetectionError("");
      setAiDetecting(false);
    } else {
      persistWorkspace(active, currentWorkspace());
      switchFunction(destinationId, documentText);
    }
    window.requestAnimationFrame(() => {
      document.getElementById("function-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const renderTransferControls = () => {
    if (busy || !output.trim()) return null;
    return (
      <>
        <button type="button" onClick={() => sendOutputToFunction(active)} className="inline-flex items-center gap-2 rounded-md border border-[#8eb0df] bg-white px-3 py-2 text-xs font-semibold text-[#205cae] hover:bg-[#eef5ff]">
          <Repeat2 className="size-3.5" />
          Reuse in this function
        </button>
        <button type="button" onClick={() => sendOutputToFunction(nextPortal.id)} className="inline-flex items-center gap-2 rounded-md bg-[#1e64c8] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1956aa]">
          Send to next: {nextPortal.number}
          <ArrowRight className="size-3.5" />
        </button>
        <select aria-label="Send document to any function" value="" onChange={(event) => sendOutputToFunction(event.target.value)} className="h-9 rounded-md border border-[#8eb0df] bg-[#f5f9ff] px-2.5 text-xs font-semibold text-[#205cae] outline-none">
          <option value="" disabled>Send to any function…</option>
          {portals.map((item) => <option key={item.id} value={item.id}>{item.number} · {item.title}{item.id === active ? " · use again" : ""}</option>)}
        </select>
      </>
    );
  };

  const runSequentialDiagnostic = async ({
    diagnosticInput,
    diagnosticPrompt,
    targetWordCount,
    requireExperimentalEvidence,
    selectedModel,
    functionsToTest = portals,
    setRunning,
    setResults,
  }: {
    diagnosticInput: string;
    diagnosticPrompt: string;
    targetWordCount: number;
    requireExperimentalEvidence: boolean;
    selectedModel: string;
    functionsToTest?: Portal[];
    setRunning: (running: boolean) => void;
    setResults: (results: DiagnosticResult[]) => void;
  }) => {
    if (diagnosticLock.current) return;
    diagnosticLock.current = true;
    const followOnInstructions: Record<string, string> = {
      objections: "Apply Function 02 to this complete paper. Strengthen the objections and replies without removing its thesis, citations, quotations, experimental evidence, or APA References section.",
      screenplay: "Apply Function 03 to this complete document. Produce the function's intended screenplay result while preserving its substantive argument and source acknowledgments.",
      dialogue: "Apply Function 04 to this complete document. Produce the function's intended dialogue result while preserving its substantive argument and source acknowledgments.",
      coherence: "Apply Function 05 to this complete document. Produce a rigorous coherence evaluation that identifies specific strengths, weaknesses, contradictions, and repairs.",
      maxintel: "Apply Function 06 to this complete document. Rewrite it for maximum intelligence, rigor, precision, and coherence without removing legitimate source acknowledgments.",
      profile: "Apply Function 07 to this complete document. Produce the function's intended cognitive profile with specific textual evidence and careful limitations.",
      thesis: "Apply Function 08 to this complete document. Produce a rigorous master's-thesis version with in-text citations and a complete APA References section.",
      dissertation: "Apply Function 09 to this complete document. Produce a rigorous dissertation version with in-text citations and a complete APA References section.",
      translation: "Apply Function 10 to this complete document. Translate it into Spanish while preserving its structure, citations, quotations, and complete APA References section.",
    };

    setRunning(true);
    setResults([]);
    setBusy(true);
    setRunFailed(false);
    commitOutput("");
    setStreamProgress("Connecting diagnostic stream…");
    setShowStreamModal(true);
    setActive("manipulator");
    setInstructions(diagnosticPrompt);
    setText(diagnosticInput);
    setTargetWords(String(targetWordCount));

    const results: DiagnosticResult[] = [];
    let currentInput = diagnosticInput;
    let firstWordDeadline: number | undefined;
    let hardDeadline: number | undefined;
    try {
      for (const portalToTest of functionsToTest) {
        setActive(portalToTest.id);
        commitOutput("");
        setStreamProgress(`Connecting Function ${portalToTest.number} diagnostic stream…`);
        const started = performance.now();
        let firstWordMs: number | null = null;
        let transcript = "";
        let providerUsed = selectedModel;
        let completed = false;
        const instructionsForFunction = portalToTest.id === "manipulator"
          ? diagnosticPrompt
          : followOnInstructions[portalToTest.id] ?? `Apply Function ${portalToTest.number} to this complete document.`;
        let result: DiagnosticResult = {
          id: `function-${portalToTest.number}-stream`,
          title: `Function ${portalToTest.number} · ${portalToTest.title} · complete raw stream transcript`,
          status: "running",
          input: currentInput,
          output: "",
          providerUsed,
          elapsedMs: 0,
          firstWordMs: null,
          wordCount: 0,
          completed: false,
          automaticRecovery: "Provider fallback, short-section repair, exact-length reconciliation, citation validation, and bibliography repair are enabled.",
        };
        results.push(result);
        setResults([...results]);
        let transcriptPaintFrame: number | undefined;
        const paintTranscript = () => {
          transcriptPaintFrame = undefined;
          result = {
            ...result,
            output: transcript,
            providerUsed,
            elapsedMs: Math.round(performance.now() - started),
            firstWordMs,
            wordCount: countWords(transcript),
          };
          results[results.length - 1] = result;
          setResults([...results]);
        };

        const requestAbort = new AbortController();
        let evidenceReady = false;
        let skeletonStarted = false;
        let planReady = false;
        let qualityFailures: string[] = [];
        firstWordDeadline = window.setTimeout(() => {
          const timingCause = evidenceReady
            ? skeletonStarted
              ? "The outline stream started, but the document-opening provider did not emit prose within the required time."
              : "Scholarly evidence retrieval completed, but the selected document provider did not emit opening prose."
            : "The request stalled before scholarly evidence preparation completed.";
          Object.assign(result, {
            title: `${result.title} · ROOT CAUSE: ${timingCause}`,
            status: "fail",
            elapsedMs: 8000,
            failureCause: timingCause,
            failureEvidence: `No document token was received during the first 8,000 ms. Selected route: ${selectedModel}.`,
            automaticRecovery: "The server's provider fallback chain remains active; the diagnostic continues so fallback output and later quality failures can be inspected.",
          });
          setResults([...results]);
          setRunFailed(true);
          setStreamProgress(timingCause);
          requestAbort.abort("No diagnostic prose was received within 8 seconds.");
        }, 8000);
        const hardDeadlineMs = Math.max(180_000, Math.ceil(targetWordCount / 1000) * 45_000);
        hardDeadline = window.setTimeout(() => {
          requestAbort.abort(`Generation exceeded the ${Math.round(hardDeadlineMs / 1000)}-second hard deadline.`);
        }, hardDeadlineMs);
        const response = await fetch(api("/functions/stream"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: requestAbort.signal,
          body: JSON.stringify({
            functionId: portalToTest.id,
            text: currentInput,
            instructions: instructionsForFunction,
            targetWords: String(targetWordCount),
            provider: selectedModel,
            thinker,
            quotes,
          }),
        });
        if (!response.ok) throw new Error(`Function ${portalToTest.number} returned HTTP ${response.status}.`);
        await consumeStream(response, (event) => {
          if (event.type === "evidence_ready") evidenceReady = true;
          if (event.type === "skeleton_token") skeletonStarted = true;
          if (event.type === "plan_ready") planReady = true;
          if (event.type === "quality_failed" && Array.isArray(event.failures)) {
            qualityFailures = event.failures.filter((failure): failure is string => typeof failure === "string");
          }
          if (event.type === "token") {
            const token = String(event.text ?? "");
            if (token && firstWordMs === null) {
              firstWordMs = Math.round(performance.now() - started);
              if (firstWordDeadline !== undefined) window.clearTimeout(firstWordDeadline);
            }
            transcript += token;
            appendStreamingOutput(token);
            setStreamProgress(`Streaming Function ${portalToTest.number} diagnostic…`);
            if (typeof event.providerUsed === "string") providerUsed = event.providerUsed;
            if (transcriptPaintFrame === undefined) {
              transcriptPaintFrame = window.requestAnimationFrame(paintTranscript);
            }
          }
          if (event.type === "replace_output" && typeof event.text === "string") {
            transcript = event.text;
            commitOutput(event.text);
            paintTranscript();
          }
          if (event.type === "done") completed = true;
          if (event.type === "error") throw new Error(String(event.message ?? `Function ${portalToTest.number} reported an error.`));
        });
        if (firstWordDeadline !== undefined) window.clearTimeout(firstWordDeadline);
        if (hardDeadline !== undefined) window.clearTimeout(hardDeadline);
        if (transcriptPaintFrame !== undefined) window.cancelAnimationFrame(transcriptPaintFrame);
        paintTranscript();

        const wordCount = countWords(transcript);
        const streamedInTime = firstWordMs !== null && firstWordMs <= 8000;
        const mechanicallyComplete = completed && wordCount === targetWordCount;
        const hasCitations = /\([^)]*(?:19|20)\d{2}[a-z]?[^)]*\)/.test(transcript);
        const hasBibliography = /(?:^|\n)\s*(?:References|Bibliography)\s*(?:\n|$)/i.test(transcript);
        const function01ScholarlyPass = portalToTest.id !== "manipulator" || (
          hasCitations
          && hasBibliography
          && (!requireExperimentalEvidence || (
            /\b(?:experiment|experimental|study|studies|trial|meta-analysis)\b/i.test(transcript)
            && /[“"][^”"]{20,}[”"]/.test(transcript)
          ))
        );
        let failureCause: string | undefined;
        let failureEvidence: string | undefined;
        if (!streamedInTime) {
          failureCause = evidenceReady
            ? "The selected provider route and its fallback did not deliver opening prose within the streaming SLA."
            : "Scholarly evidence preparation or the provider connection stalled before opening prose.";
          failureEvidence = `First document word: ${firstWordMs === null ? "never received" : `${firstWordMs} ms`}; required: 8,000 ms or less. Outline started: ${skeletonStarted ? "yes" : "no"}. Plan completed: ${planReady ? "yes" : "no"}.`;
        } else if (!completed) {
          failureCause = "The SSE connection ended before the server emitted a validated completion event.";
          failureEvidence = `The browser retained ${wordCount.toLocaleString()} words, but no final done event was received.`;
        } else if (wordCount !== targetWordCount) {
          failureCause = "Exact-length reconciliation failed.";
          failureEvidence = `Requested ${targetWordCount.toLocaleString()} words; received ${wordCount.toLocaleString()} words.`;
        } else if (portalToTest.id === "manipulator" && !hasCitations) {
          failureCause = "The evidence-to-prose stage failed to insert supported in-text citations.";
          failureEvidence = "No author-year citation marker was found in the complete transcript.";
        } else if (portalToTest.id === "manipulator" && !hasBibliography) {
          failureCause = "The bibliography repair stage failed or never ran.";
          failureEvidence = "No References or Bibliography section was found in the complete transcript.";
        } else if (qualityFailures.length) {
          failureCause = "The server rejected the generated document during final quality validation.";
          failureEvidence = qualityFailures.join(" ");
        } else if (!function01ScholarlyPass) {
          failureCause = "The paper did not satisfy the diagnostic's experimental-evidence or verified-quotation requirements.";
          failureEvidence = "The transcript completed, but one or more required scholarly evidence patterns were absent.";
        }
        const passed = streamedInTime && mechanicallyComplete && function01ScholarlyPass;
        const recoveryReport = passed
          ? "No recovery was required."
          : "Automatic provider fallback, short-section supplementation, exact-length reconciliation, citation validation, and bibliography repair were attempted. Partial output remains available for resume.";
        Object.assign(result, {
          title: failureCause
            ? `${result.title.split(" · ROOT CAUSE:")[0]} · ROOT CAUSE: ${failureCause} · EVIDENCE: ${failureEvidence} · AUTOMATIC RECOVERY: ${recoveryReport}`
            : result.title,
          status: passed ? "pass" : "fail",
          output: transcript,
          providerUsed,
          elapsedMs: Math.round(performance.now() - started),
          firstWordMs,
          wordCount,
          completed,
          failureCause,
          failureEvidence,
          automaticRecovery: recoveryReport,
        });
        setResults([...results]);
        if (result.status !== "pass") {
          setRunFailed(true);
          setStreamProgress(failureCause || "The diagnostic failed before reaching its required output.");
          break;
        }

        persistWorkspace(portalToTest.id, {
          ...emptyFunctionWorkspace(),
          text: currentInput,
          instructions: instructionsForFunction,
          targetWords: String(targetWordCount),
          model: selectedModel,
          thinker,
          quotes,
          output: transcript,
          streamProgress: "Diagnostic passed",
        });
        currentInput = transcript;
        const nextIndex = portals.findIndex((item) => item.id === portalToTest.id) + 1;
        const next = portals[nextIndex];
        if (next) {
          persistWorkspace(next.id, {
            ...emptyFunctionWorkspace(),
            text: transcript,
            model: selectedModel,
            thinker,
            quotes,
          });
        }
      }
    } catch (error) {
      const current = results.at(-1);
      if (current) {
        const message = error instanceof Error
          ? error.message
          : "The diagnostic stopped before the function completed.";
        Object.assign(current, {
          title: `${current.title.split(" · ROOT CAUSE:")[0]} · ROOT CAUSE: ${
            /abort|deadline|timeout/i.test(message)
              ? "The generation exceeded its deadline or its connection was interrupted."
              : /citation/i.test(message)
                ? "Citation validation or evidence integration failed."
                : /bibliograph|reference/i.test(message)
                  ? "Bibliography construction or validation failed."
                  : /exact|words/i.test(message)
                    ? "Exact-length reconciliation failed."
                    : "The server reported an unclassified generation failure."
          } · EVIDENCE: ${message} · AUTOMATIC RECOVERY: Provider fallback and generation repair were attempted before the failure was returned.`,
          status: "fail",
          output: current.output || `[FAILED] ${message}`,
          elapsedMs: current.elapsedMs || 8000,
          completed: false,
          failureCause: /abort|deadline|timeout/i.test(message)
            ? "The generation exceeded its deadline or its connection was interrupted."
            : /citation/i.test(message)
              ? "Citation validation or evidence integration failed."
              : /bibliograph|reference/i.test(message)
                ? "Bibliography construction or validation failed."
                : /exact|words/i.test(message)
                  ? "Exact-length reconciliation failed."
                  : "The server reported an unclassified generation failure.",
          failureEvidence: message,
          automaticRecovery: "Provider fallback and generation repair were attempted before the failure was returned. Any partial transcript remains visible and can be resumed.",
        });
        setResults([...results]);
        setRunFailed(true);
        setStreamProgress(current.failureCause || message);
      }
    } finally {
      if (firstWordDeadline !== undefined) window.clearTimeout(firstWordDeadline);
      if (hardDeadline !== undefined) window.clearTimeout(hardDeadline);
      diagnosticLock.current = false;
      setRunning(false);
      setBusy(false);
    }
  };

  const runDiagnostics = () => runSequentialDiagnostic({
    diagnosticInput: DIAGNOSTIC_SOURCE,
    diagnosticPrompt: "CONVERT FOLLOWING INTO WELL-RESEARCHED RIGOROUS RESEARCH PAPER. MAKE SURE IT IS REPLETE WITH LEGITIMATE REFERENCES TO BIOLOGICAL AND PSYHCHOLOGICAL LITERATURE, ESPECIALLY EVOLUTIONARY PSYCHOLOGY, AND IDENTIFY RELEVANT EXPERIMENTAL WORK. FULL BIBLIOGRAPHY AND IN-TEXT REFERENCES, AND SEVERAL LEGITIMATE RECENT SCHOLARLY QUOTATIONS.",
    targetWordCount: 3000,
    requireExperimentalEvidence: true,
    selectedModel: diagnosticModel,
    setRunning: setDiagnosing,
    setResults: setDiagnostics,
  });

  const runSecondaryDiagnostics = (reuseSelected = false) => {
    const randomIndex = crypto.getRandomValues(new Uint32Array(1))[0] % diagnosticTheses.length;
    const selectedThesis = reuseSelected && selectedDiagnosticThesis
      ? selectedDiagnosticThesis
      : diagnosticTheses[randomIndex];
    setSelectedDiagnosticThesis(selectedThesis);
    return runSequentialDiagnostic({
      diagnosticInput: selectedThesis,
      diagnosticPrompt: "TURN INTO SCHOLARLY 2000 WORD PAPER",
      targetWordCount: 2000,
      requireExperimentalEvidence: false,
      selectedModel: secondaryDiagnosticModel,
      setRunning: setDiagnosingSecondary,
      setResults: setSecondaryDiagnostics,
    });
  };

  const runFiftyKDiagnostics = (reuseSelected = false) => {
    const randomIndex = crypto.getRandomValues(new Uint32Array(1))[0] % diagnosticTheses.length;
    const selectedThesis = reuseSelected && selectedFiftyKThesis
      ? selectedFiftyKThesis
      : diagnosticTheses[randomIndex];
    setSelectedFiftyKThesis(selectedThesis);
    return runSequentialDiagnostic({
      diagnosticInput: selectedThesis,
      diagnosticPrompt: "TURN INTO A RIGOROUS SCHOLARLY 50000 WORD DOCUMENT WITH LEGITIMATE IN-TEXT CITATIONS, VERIFIED SCHOLARLY QUOTATIONS, AND A COMPLETE APA BIBLIOGRAPHY",
      targetWordCount: 50000,
      requireExperimentalEvidence: false,
      selectedModel: fiftyKDiagnosticModel,
      functionsToTest: [portals[0]],
      setRunning: setDiagnosingFiftyK,
      setResults: setFiftyKDiagnostics,
    });
  };

  const anyDiagnosticRunning = diagnosing || diagnosingSecondary || diagnosingFiftyK;
  const applyFunctionOneDiagnosticPreset = (preset: string) => {
    setFunctionOnePreset(preset);
    if (preset === "fixed-3000") {
      setText(DIAGNOSTIC_SOURCE);
      setInstructions("CONVERT FOLLOWING INTO WELL-RESEARCHED RIGOROUS RESEARCH PAPER. MAKE SURE IT IS REPLETE WITH LEGITIMATE REFERENCES TO BIOLOGICAL AND PSYHCHOLOGICAL LITERATURE, ESPECIALLY EVOLUTIONARY PSYCHOLOGY, AND IDENTIFY RELEVANT EXPERIMENTAL WORK. FULL BIBLIOGRAPHY AND IN-TEXT REFERENCES, AND SEVERAL LEGITIMATE RECENT SCHOLARLY QUOTATIONS.");
      setTargetWords("3000");
      return;
    }
    if (preset === "random-2000" || preset === "random-50000") {
      const randomIndex = crypto.getRandomValues(new Uint32Array(1))[0] % diagnosticTheses.length;
      setText(diagnosticTheses[randomIndex]);
      if (preset === "random-2000") {
        setInstructions("TURN INTO SCHOLARLY 2000 WORD PAPER");
        setTargetWords("2000");
      } else {
        setInstructions("TURN INTO A RIGOROUS SCHOLARLY 50000 WORD DOCUMENT WITH LEGITIMATE IN-TEXT CITATIONS, VERIFIED SCHOLARLY QUOTATIONS, AND A COMPLETE APA BIBLIOGRAPHY");
        setTargetWords("50000");
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-[#152238]">
      <header className="border-b border-[#dce1e9] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-5 py-4 lg:px-8">
          <a href="/" className="text-xl font-bold tracking-tight text-[#12223a]">NEUROTEXT</a>
          <div className="flex items-center gap-5 text-sm">
            {!showStreamModal && <button type="button" onClick={startAgain} className="rounded border border-[#d9a79b] bg-white px-2 py-1 text-xs font-semibold text-[#a4432d] hover:bg-[#fff7f5]">ERASE EVERYTHING</button>}
            {isPermanentOwner && (diagnosticsOnly ? <a className="font-semibold text-[#1e64c8] hover:underline" href={import.meta.env.BASE_URL}>Return to NEUROTEXT</a> : <a className="font-semibold text-[#1e64c8] hover:underline" href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/diagnostics`}>Diagnostics</a>)}
            <a className="font-medium text-[#1e64c8] hover:underline" href="mailto:zhi@zhisystems.org"><Mail className="mr-1 inline size-4" />Contact us</a>
            {user ? <><span className="hidden text-[#64748b] lg:inline">{isDevelopmentOwner ? "Development owner · Always signed in" : user.name}</span>{user.picture && <img src={user.picture} alt="" referrerPolicy="no-referrer" className="size-7 rounded-full" />}{!isDevelopmentOwner && <button type="button" onClick={onLogout} className="font-semibold text-[#1e64c8] hover:underline">Sign out</button>}</> : <a href={loginUrl} className="rounded-md bg-[#1e64c8] px-3 py-2 font-semibold text-white hover:bg-[#1956aa]">Sign in with Google</a>}
            <span className="hidden text-[#64748b] sm:inline">Visitors: {visitorCount === null ? "—" : visitorCount.toLocaleString()}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8 lg:px-8 lg:py-12">
        <section className={`${diagnosticsOnly ? "mb-7" : "hidden"} rounded-xl border border-[#dce1e9] bg-white p-5 shadow-sm lg:p-7`}>
          <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.14em] text-[#1e64c8]">Live diagnostics</p><h2 className="mt-1 text-xl font-bold">Functions 01–10 sequential diagnostic</h2><p className="mt-2 text-sm text-[#56647a]">Runs the fixed 3,000-word Function 01 research-paper test, then transfers each passing result through Functions 02–10. Every generated word is displayed exactly as received.</p></div><div className="flex flex-wrap items-end gap-3"><label className="text-xs font-semibold text-[#56647a]">Diagnostic model<select aria-label="First diagnostic model" value={diagnosticModel} disabled={anyDiagnosticRunning} onChange={(event) => setDiagnosticModel(event.target.value)} className="mt-1 block h-10 rounded-md border border-[#b9c8db] bg-white px-3 text-sm text-[#152238] outline-none disabled:opacity-50"><option value="GENIUS · Kuczynski">GENIUS 101 · Kuczynski</option>{models.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><button disabled={anyDiagnosticRunning} onClick={runDiagnostics} className="inline-flex h-10 items-center gap-2 rounded-md border border-[#1e64c8] px-4 text-sm font-semibold text-[#1e64c8] hover:bg-[#eef5ff] disabled:opacity-50"><ShieldCheck className="size-4" />{diagnosing ? "Running sequential diagnostic…" : "Run Functions 01–10 diagnostic"}</button></div></div>
          <div className="mt-5">{diagnostics.length === 0 ? <div className="rounded-lg bg-[#f5f7fa] p-5 text-sm text-[#64748b]">Ready. The fixed Function 01 source, exact research-paper prompt, 3,000-word target, eight-second first-word limit, and sequential transfers are built in.</div> : diagnostics.map((check) => <article key={check.id} className="rounded-lg border border-[#dce1e9] p-4"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{check.title}</h3><span className={`rounded px-2 py-1 text-xs font-bold ${check.status === "pass" ? "bg-[#e8f7ee] text-[#16703a]" : check.status === "running" ? "bg-[#eaf2ff] text-[#1e64c8]" : "bg-[#fff0ed] text-[#b53c1f]"}`}>{check.status.toUpperCase()}</span></div><dl className="mt-4 grid gap-3 text-xs sm:grid-cols-4"><div><dt className="font-semibold text-[#56647a]">Model used</dt><dd>{check.providerUsed}</dd></div><div><dt className="font-semibold text-[#56647a]">First generated word</dt><dd>{check.firstWordMs === null ? "No words received" : `${check.firstWordMs} ms`}</dd></div><div><dt className="font-semibold text-[#56647a]">Elapsed time</dt><dd>{check.elapsedMs} ms</dd></div><div><dt className="font-semibold text-[#56647a]">Generated words</dt><dd>{check.wordCount}</dd></div></dl><div className="mt-4"><p className="text-xs font-semibold text-[#56647a]">Complete verbatim generated transcript</p><div className="mt-2 max-h-[36rem] overflow-auto whitespace-pre-wrap rounded bg-[#f7f8fa] p-4 font-sans text-sm leading-6 text-[#24334a]">{check.output || "[No generated words received]"}</div></div></article>)}</div>
          {diagnostics.some((check) => check.status === "fail") && !anyDiagnosticRunning && <button type="button" onClick={runDiagnostics} className="mt-4 rounded-md bg-[#1e64c8] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1956aa]">Automatically recover and rerun the same diagnostic</button>}
        </section>

        <section className={`${diagnosticsOnly ? "mb-7" : "hidden"} rounded-xl border border-[#dce1e9] bg-white p-5 shadow-sm lg:p-7`}>
          <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.14em] text-[#1e64c8]">Random-thesis diagnostics</p><h2 className="mt-1 text-xl font-bold">Second Functions 01–10 sequential diagnostic</h2><p className="mt-2 text-sm text-[#56647a]">Randomly selects one of 100 supplied theses, places it in Step 2, runs “TURN INTO SCHOLARLY 2000 WORD PAPER,” and transfers each passing result through Functions 02–10.</p></div><div className="flex flex-wrap items-end gap-3"><label className="text-xs font-semibold text-[#56647a]">Diagnostic model<select aria-label="Second diagnostic model" value={secondaryDiagnosticModel} disabled={anyDiagnosticRunning} onChange={(event) => setSecondaryDiagnosticModel(event.target.value)} className="mt-1 block h-10 rounded-md border border-[#b9c8db] bg-white px-3 text-sm text-[#152238] outline-none disabled:opacity-50"><option value="GENIUS · Kuczynski">GENIUS 101 · Kuczynski</option>{models.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><button disabled={anyDiagnosticRunning} onClick={() => runSecondaryDiagnostics()} className="inline-flex h-10 items-center gap-2 rounded-md border border-[#1e64c8] px-4 text-sm font-semibold text-[#1e64c8] hover:bg-[#eef5ff] disabled:opacity-50"><ShieldCheck className="size-4" />{diagnosingSecondary ? "Running random-thesis diagnostic…" : "Run random-thesis Functions 01–10 diagnostic"}</button></div></div>
          <div className="mt-5 rounded-lg bg-[#f5f7fa] p-5 text-sm text-[#56647a]"><span className="font-semibold text-[#223750]">Selected Step 2 thesis:</span> {selectedDiagnosticThesis || "A thesis will be randomly selected from the 100 supplied statements when the diagnostic starts."}</div>
          <div className="mt-5">{secondaryDiagnostics.length === 0 ? <div className="rounded-lg border border-[#dce1e9] p-5 text-sm text-[#64748b]">Ready. The exact command, 2,000-word target, scholarly citation requirement, APA bibliography requirement, eight-second first-word limit, and sequential transfers are built in.</div> : secondaryDiagnostics.map((check) => <article key={check.id} className="rounded-lg border border-[#dce1e9] p-4"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{check.title}</h3><span className={`rounded px-2 py-1 text-xs font-bold ${check.status === "pass" ? "bg-[#e8f7ee] text-[#16703a]" : check.status === "running" ? "bg-[#eaf2ff] text-[#1e64c8]" : "bg-[#fff0ed] text-[#b53c1f]"}`}>{check.status.toUpperCase()}</span></div><dl className="mt-4 grid gap-3 text-xs sm:grid-cols-4"><div><dt className="font-semibold text-[#56647a]">Model used</dt><dd>{check.providerUsed}</dd></div><div><dt className="font-semibold text-[#56647a]">First generated word</dt><dd>{check.firstWordMs === null ? "No words received" : `${check.firstWordMs} ms`}</dd></div><div><dt className="font-semibold text-[#56647a]">Elapsed time</dt><dd>{check.elapsedMs} ms</dd></div><div><dt className="font-semibold text-[#56647a]">Generated words</dt><dd>{check.wordCount}</dd></div></dl><div className="mt-4"><p className="text-xs font-semibold text-[#56647a]">Complete verbatim generated transcript</p><div className="mt-2 max-h-[36rem] overflow-auto whitespace-pre-wrap rounded bg-[#f7f8fa] p-4 font-sans text-sm leading-6 text-[#24334a]">{check.output || "[No generated words received]"}</div></div></article>)}</div>
          {secondaryDiagnostics.some((check) => check.status === "fail") && !anyDiagnosticRunning && <button type="button" onClick={() => runSecondaryDiagnostics(true)} className="mt-4 rounded-md bg-[#1e64c8] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1956aa]">Automatically recover and rerun this same thesis</button>}
        </section>

        <section className={`${diagnosticsOnly ? "mb-7" : "hidden"} rounded-xl border border-[#dce1e9] bg-white p-5 shadow-sm lg:p-7`}>
          <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.14em] text-[#1e64c8]">Extreme-length diagnostic</p><h2 className="mt-1 text-xl font-bold">50,000-word Function 01 diagnostic</h2><p className="mt-2 text-sm text-[#56647a]">Randomly selects one of the same 100 supplied theses and attempts one complete 50,000-word scholarly document in Function 01. It records every generated word and stops with an explicit failure if length or scholarly validation fails.</p></div><div className="flex flex-wrap items-end gap-3"><label className="text-xs font-semibold text-[#56647a]">Diagnostic model<select aria-label="50,000-word diagnostic model" value={fiftyKDiagnosticModel} disabled={anyDiagnosticRunning} onChange={(event) => setFiftyKDiagnosticModel(event.target.value)} className="mt-1 block h-10 rounded-md border border-[#b9c8db] bg-white px-3 text-sm text-[#152238] outline-none disabled:opacity-50"><option value="GENIUS · Kuczynski">GENIUS 101 · Kuczynski</option>{models.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><button disabled={anyDiagnosticRunning} onClick={() => runFiftyKDiagnostics()} className="inline-flex h-10 items-center gap-2 rounded-md border border-[#1e64c8] px-4 text-sm font-semibold text-[#1e64c8] hover:bg-[#eef5ff] disabled:opacity-50"><ShieldCheck className="size-4" />{diagnosingFiftyK ? "Running 50,000-word diagnostic…" : "Run 50,000-word diagnostic"}</button></div></div>
          <div className="mt-5 rounded-lg bg-[#f5f7fa] p-5 text-sm text-[#56647a]"><span className="font-semibold text-[#223750]">Selected thesis:</span> {selectedFiftyKThesis || "A thesis will be randomly selected from the same 100 supplied statements when the diagnostic starts."}</div>
          <div className="mt-5">{fiftyKDiagnostics.length === 0 ? <div className="rounded-lg border border-[#dce1e9] p-5 text-sm text-[#64748b]">Ready. This test targets exactly 50,000 words, uses an eight-second first-word grade, permits a length-aware hard deadline, displays the complete transcript, and tests Function 01 only.</div> : fiftyKDiagnostics.map((check) => <article key={check.id} className="rounded-lg border border-[#dce1e9] p-4"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{check.title}</h3><span className={`rounded px-2 py-1 text-xs font-bold ${check.status === "pass" ? "bg-[#e8f7ee] text-[#16703a]" : check.status === "running" ? "bg-[#eaf2ff] text-[#1e64c8]" : "bg-[#fff0ed] text-[#b53c1f]"}`}>{check.status.toUpperCase()}</span></div><dl className="mt-4 grid gap-3 text-xs sm:grid-cols-4"><div><dt className="font-semibold text-[#56647a]">Model used</dt><dd>{check.providerUsed}</dd></div><div><dt className="font-semibold text-[#56647a]">First generated word</dt><dd>{check.firstWordMs === null ? "No words received" : `${check.firstWordMs} ms`}</dd></div><div><dt className="font-semibold text-[#56647a]">Elapsed time</dt><dd>{check.elapsedMs} ms</dd></div><div><dt className="font-semibold text-[#56647a]">Generated words</dt><dd>{check.wordCount}</dd></div></dl><div className="mt-4"><p className="text-xs font-semibold text-[#56647a]">Complete verbatim generated transcript</p><div className="mt-2 max-h-[36rem] overflow-auto whitespace-pre-wrap rounded bg-[#f7f8fa] p-4 font-sans text-sm leading-6 text-[#24334a]">{check.output || "[No generated words received]"}</div></div></article>)}</div>
          {fiftyKDiagnostics.some((check) => check.status === "fail") && !anyDiagnosticRunning && <button type="button" onClick={() => runFiftyKDiagnostics(true)} className="mt-4 rounded-md bg-[#1e64c8] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1956aa]">Automatically recover and rerun this same 50,000-word thesis</button>}
        </section>

        <div className={diagnosticsOnly ? "hidden" : undefined}>
        <section className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${!freeUsage?.unlimited && freeUsage?.remainingOperations === 0 ? "border-[#e7c98d] bg-[#fff8e8]" : "border-[#bfd2f1] bg-[#f5f9ff]"}`}>
          <div>
            <span className="font-semibold text-[#223750]">{freeUsage?.ownerAccess ? "Permanent owner access" : freeUsage?.unlimited ? "Development access" : billingActive ? "Paid NEUROTEXT access" : user ? "Google account free allowance" : "Anonymous trial"}</span>
            <span className="ml-2 text-[#56647a]">{freeUsage?.ownerAccess ? "Highest tier · Unlimited operations · Never expires" : freeUsage?.unlimited ? "Unlimited — development is never subject to customer limits" : billingActive ? "Active — unlimited operations" : freeUsage ? `${freeUsage.remainingOperations} of ${freeUsage.limitOperations} substantial operations remaining` : "Checking free usage…"}</span>
          </div>
          {!freeUsage?.unlimited && !user ? <a href={loginUrl} className="rounded-md bg-[#1e64c8] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1956aa]">Sign in with Google for 20 more operations</a> : !freeUsage?.ownerAccess && !billingActive && user && freeUsage?.remainingOperations === 0 ? <button type="button" disabled={checkoutBusy || !subscriptionPlan?.active} onClick={startSubscription} className="rounded-md bg-[#1e64c8] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1956aa] disabled:opacity-60">{checkoutBusy ? "Opening Stripe checkout…" : "Subscribe"}</button> : null}
        </section>
        {billingActive && <section className="mb-8 rounded-xl border-4 border-[#168348] bg-[#eafaf1] p-6 shadow-md" role="status" aria-live="polite">
          <p className="text-sm font-black uppercase tracking-[.18em] text-[#126638]">✓ {freeUsage?.ownerAccess ? "Permanent owner access" : "Subscription active"}</p>
          <h2 className="mt-2 text-3xl font-black text-[#0b4d2a]">{freeUsage?.ownerAccess ? "Highest-tier unlimited access is permanently active" : subscriptionPlan?.name ?? "Paid subscription access is active"}</h2>
          <p className="mt-3 text-base font-semibold text-[#245d3e]">{freeUsage?.ownerAccess ? "Stripe, subscriptions, paywalls, expiration, credit balances, and generation quotas are bypassed for this authenticated owner account." : subscriptionPlan?.description ?? "Your subscription is confirmed."}</p>
          {!freeUsage?.ownerAccess && <button type="button" onClick={openBillingPortal} className="mt-5 rounded-md bg-[#126638] px-5 py-3 text-sm font-bold text-white hover:bg-[#0b4d2a]">Manage subscription and billing</button>}
        </section>}
        {!billingActive && latestPayment && <section className="mb-8 rounded-xl border-4 border-[#168348] bg-[#eafaf1] p-6 shadow-md" role="status" aria-live="polite">
          <p className="text-sm font-black uppercase tracking-[.18em] text-[#126638]">✓ Payment received</p>
          <h2 className="mt-2 text-3xl font-black text-[#0b4d2a]">{latestPayment.amount !== null && latestPayment.currency ? new Intl.NumberFormat("en-US", { style: "currency", currency: latestPayment.currency }).format(latestPayment.amount / 100) : "Your payment"} was successfully paid</h2>
          <p className="mt-3 text-base font-semibold text-[#245d3e]">{latestPayment.mode === "subscription" ? "Your subscription payment was received. Subscription activation is being confirmed." : "Your one-time Stripe payment is confirmed."}</p>
        </section>}
        <section className="mb-8 max-w-3xl">
          <p className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-[#1e64c8]">Document intelligence platform</p>
          <h1 className="text-3xl font-bold tracking-tight text-[#12223a] sm:text-5xl">Work with a document. Get a coherent result.</h1>
          <p className="mt-4 text-base leading-7 text-[#56647a]">Every function has its own dedicated document portal. Choose a function, provide its document, choose an LLM, then run it.</p>
        </section>

        <section className="mb-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-5" aria-label="Functions">
          {portals.map((item) => (
            <button key={item.id} disabled={busy && active !== item.id} onClick={() => switchFunction(item.id)} className={`rounded-lg border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${active === item.id ? "border-[#1e64c8] bg-[#eaf2ff] shadow-sm" : "border-[#dce1e9] bg-white hover:border-[#94b8ef]"}`}>
              <span className="text-xs font-bold text-[#1e64c8]">{item.number}</span>
              <span className="mt-2 block text-sm font-semibold leading-5">{item.title}</span>
              {((item.id === active ? output : functionWorkspaces.current[item.id]?.output) ?? "").trim() && <span className="mt-2 block text-xs font-medium text-[#16703a]">Paper retained</span>}
            </button>
          ))}
        </section>

        <section id="function-workspace" className="scroll-mt-4 rounded-xl border border-[#dce1e9] bg-white shadow-sm">
          <div className="border-b border-[#dce1e9] px-5 py-5 sm:px-7">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-[.14em] text-[#1e64c8]">Function {portal.number}</p><h2 className="mt-1 text-2xl font-bold">{portal.title}</h2><p className="mt-2 text-sm text-[#56647a]">{portal.description}</p></div>
            </div>
          </div>
          {portal.id === "manipulator" && <div className="border-b border-[#b8cff0] bg-[#eaf2ff] p-5 sm:p-7">
            <p className="text-xs font-bold uppercase tracking-[.16em] text-[#1e64c8]">Two ways to use Function 1</p>
            <h3 className="mt-1 text-xl font-bold text-[#12223a]">Create something new or work from existing material</h3>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border-2 border-[#1e64c8] bg-white p-4">
                <p className="text-base font-bold text-[#12223a]">1. Start completely from scratch</p>
                <p className="mt-2 text-sm leading-6 text-[#46566e]">Enter what you want in the Instructions box. Leave the Source document box empty. NEUROTEXT will create the document entirely from your instructions.</p>
              </div>
              <div className="rounded-lg border-2 border-[#7f9fc9] bg-white p-4">
                <p className="text-base font-bold text-[#12223a]">2. Modify or build from a source</p>
                <p className="mt-2 text-sm leading-6 text-[#46566e]">Enter what you want in the Instructions box, then paste or upload an existing paper, notes, outline, or other source material below.</p>
              </div>
            </div>
          </div>}
          <div className="border-b border-[#dce1e9] bg-[#f5f9ff] p-5 sm:p-7">
            {portal.id === "manipulator" && (
              <label className="mb-5 block">
                <span className="block text-xs font-bold uppercase tracking-[.14em] text-[#1e64c8]">Function 01 diagnostic preset</span>
                <span className="mt-1 block text-sm text-[#56647a]">Load the identical source, instructions, and target length used by an owner diagnostic into the normal Function 01 interface.</span>
                <select
                  aria-label="Function 01 diagnostic preset"
                  value={functionOnePreset}
                  onChange={(event) => applyFunctionOneDiagnosticPreset(event.target.value)}
                  className="mt-3 h-11 w-full rounded-md border border-[#8eb0df] bg-white px-3 text-sm font-semibold text-[#205cae] outline-none focus:ring-4 focus:ring-[#dbeafe]"
                >
                  <option value="">Choose a diagnostic preset…</option>
                  <option value="fixed-3000">Fixed collective-psychology scholarly paper · 3,000 words</option>
                  <option value="random-2000">Random supplied thesis · exact diagnostic command · 2,000 words</option>
                  <option value="random-50000">Random supplied thesis · scholarly document · 50,000 words</option>
                </select>
              </label>
            )}
            <label htmlFor="function-instructions" className="block">
              <span className="block text-xs font-bold uppercase tracking-[.14em] text-[#1e64c8]">Step 1 · Instructions</span>
              <span className="mt-1 block text-lg font-bold text-[#152238]">What should NEUROTEXT do?</span>
              <span className="mt-1 block text-sm text-[#56647a]">{portal.id === "manipulator" ? "Describe the new document you want created from scratch, or explain how NEUROTEXT should modify or use the optional source material below." : "Give the complete command for how the separate source document should be transformed, analyzed, refuted, translated, or used."}</span>
              <textarea id="function-instructions" value={portal.id === "manipulator" && !instructions.trim() ? DEFAULT_FUNCTION_ONE_INSTRUCTIONS : instructions} onChange={(event) => setInstructions(event.target.value)} className="mt-4 min-h-36 w-full resize-y rounded-lg border-2 border-[#1e64c8] bg-white p-4 text-base leading-7 outline-none placeholder:text-[#8391a5] focus:ring-4 focus:ring-[#dbeafe]" placeholder="Example: Rewrite this paper as a rigorous 3,000-word scholarly argument. Preserve its central thesis, address the strongest objection, and do not invent citations." />
            </label>
            {portal.id === "manipulator" && <div className="mt-4"><p className="mb-2 text-xs font-semibold text-[#56647a]">Optional instruction shortcuts — these fill the instruction box above:</p><div className="flex flex-wrap gap-2">{presets.map((preset) => <button type="button" key={preset} onClick={() => setInstructions(preset)} className="rounded border border-[#8eb0df] bg-white px-3 py-2 text-xs font-medium text-[#205cae] hover:bg-[#eef5ff]">{preset}</button>)}</div></div>}
          </div>
          <div className="grid gap-7 p-5 lg:grid-cols-[1.15fr_.85fr] lg:p-7">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.14em] text-[#1e64c8]">{portal.id === "manipulator" ? "Step 2 · Source document · Optional" : "Step 2 · Source document"}</p>
              <label className="mb-2 mt-1 block text-lg font-bold">{portal.id === "manipulator" ? "Leave empty when starting from scratch, or add existing material" : "Material to transform, analyze, refute, or draw from"}</label>
              <p className="mb-3 text-sm text-[#56647a]">{sourceRequired ? "This function requires source material. Paste or upload it here. Instructions belong only in the instruction box above." : "Optional: paste or upload source material here, or leave this empty to create entirely from the instruction box above."}</p>
                <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); loadFile(event.dataTransfer.files[0]); }} className="rounded-lg border-2 border-dashed border-[#b9c8db] bg-[#fbfdff] p-4">
                <textarea value={text} onChange={(event) => setText(event.target.value)} className="min-h-[230px] w-full resize-y bg-transparent text-sm leading-6 outline-none placeholder:text-[#8391a5]" placeholder={portal.placeholder} />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[#e5e9ef] pt-3">
                  <span className="text-xs text-[#64748b]">Paste text, drag a file here, or upload a document/screenshot for OCR.</span>
                  <button onClick={() => fileInput.current?.click()} type="button" className="inline-flex items-center gap-2 rounded-md border border-[#b9c8db] bg-white px-3 py-2 text-xs font-semibold text-[#205cae]"><Upload className="size-4" />Upload document</button>
                  <input ref={fileInput} className="hidden" type="file" accept=".txt,.md,.doc,.docx,.pdf,image/*" onChange={(event) => loadFile(event.target.files?.[0])} />
                </div>
                  <div className="mt-3 grid gap-2 border-t border-[#e5e9ef] pt-3 sm:grid-cols-[.7fr_1.3fr]">
                    <div className="rounded-md bg-[#f1f6fd] px-3 py-2.5 text-sm text-[#24334a]"><span className="font-semibold">{wordCount.toLocaleString()}</span> {wordCount === 1 ? "word" : "words"}</div>
                    <div aria-live="polite" className="rounded-md border border-[#d6e3f5] bg-white px-3 py-2.5 text-xs leading-5 text-[#46566e]">
                      <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-[#223750]">AI detector</span>{aiDetecting ? <span className="inline-flex items-center gap-1.5 text-[#1e64c8]"><Loader2 className="size-3.5 animate-spin" />Analyzing…</span> : aiDetection ? <span className={`font-semibold ${aiDetection.aiProbability >= 70 ? "text-[#b53c1f]" : aiDetection.aiProbability >= 40 ? "text-[#9a6700]" : "text-[#16703a]"}`}>{aiDetection.label} · {aiDetection.aiProbability}% AI-likely</span> : <span className="text-[#64748b]">{aiDetectionError ? "Unavailable" : "Waiting for text"}</span>}</div>
                      {aiDetection ? <p className="mt-1">{aiDetection.explanation} <span className="text-[#64748b]">Checked with {aiDetection.providerUsed}. Estimate only.</span></p> : aiDetectionError ? <p className="mt-1 text-[#b53c1f]">{aiDetectionError}</p> : <p className="mt-1">Automatically checks after you pause typing.</p>}
                    </div>
                  </div>
              </div>
            </div>
            <div className="space-y-5">
              <label className="block"><span className="mb-2 block text-sm font-semibold">Choose LLM</span><select value={model} onChange={(event) => setModel(event.target.value)} className="h-11 w-full rounded-md border border-[#b9c8db] bg-white px-3 text-sm outline-none"><option value="GENIUS · Kuczynski">GENIUS 101 · Kuczynski (scholarly/style knowledge)</option><option value="ZHI 1">ZHI 1 · OpenAI GPT-5.6 Terra</option><option value="ZHI 2">ZHI 2 · Anthropic Claude Sonnet 4.6</option><option value="ZHI 3">ZHI 3 · OpenAI GPT-5.6 Terra</option><option value="ZHI 4">ZHI 4 · OpenAI GPT-5.6 Terra</option><option value="ZHI 5">ZHI 5 · Anthropic Claude Sonnet 4.6</option><option value="ZHI 6">ZHI 6 · OpenAI GPT-5.6 Terra</option></select><p className="mt-2 text-xs leading-5 text-[#64748b]">The selected provider is shown here; the evaluator also reports the provider that actually completed the run if it had to fail over.</p></label>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_150px]">
                 <label className="block"><span className="mb-2 block text-sm font-semibold">Thinker perspective and style <span className="font-normal text-[#64748b]">(optional)</span></span><select value={thinker} onChange={(event) => { const nextThinker = event.target.value; setThinker(nextThinker); if (!nextThinker) setQuotes(0); }} className="h-11 w-full rounded-md border border-[#b9c8db] bg-white px-3 py-2 text-sm outline-none"><option value="">Standard NEUROTEXT style</option>{thinkers.map((name) => <option key={name} value={name}>{name}</option>)}</select><p className="mt-2 text-xs leading-5 text-[#64748b]">Select a named thinker only when you want that perspective and writing style. The standard option uses NEUROTEXT’s own style.</p></label>
                 <label className="block"><span className="mb-2 block text-sm font-semibold">Author quotes <span className="font-normal text-[#64748b]">(optional)</span></span><input type="number" min={0} max={20} step={1} value={quotes} disabled={!thinker} onChange={(event) => setQuotes(Math.max(0, Math.min(20, Number(event.target.value) || 0)))} className="h-11 w-full rounded-md border border-[#b9c8db] bg-white px-3 text-sm outline-none disabled:cursor-not-allowed disabled:bg-[#f1f4f8] disabled:text-[#94a3b8]" /><p className="mt-2 text-xs leading-5 text-[#64748b]">{thinker ? "0–20 verified quotes from the selected thinker." : "Select a thinker to enable optional author quotes."}</p></label>
              </div>
               {portal.id === "coherence" && <label className="block"><span className="mb-2 block text-sm font-semibold">Coherence mode</span><select value={coherenceMode} onChange={(event) => setCoherenceMode(event.target.value)} className="h-11 w-full rounded-md border border-[#b9c8db] bg-white px-3 text-sm outline-none">{coherenceModes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><p className="mt-2 text-xs leading-5 text-[#64748b]">Choose the standard against which this document is audited. Autodetect selects the dominant reasoning lens from the supplied document.</p></label>}
               {portal.id === "coherence" && <label className="flex items-start gap-3 rounded-md border border-[#dce1e9] bg-[#fbfdff] p-3 text-xs leading-5 text-[#56647a]"><input type="checkbox" checked={allowFallback} onChange={(event) => setAllowFallback(event.target.checked)} className="mt-0.5 size-4 accent-[#1e64c8]" /><span><span className="font-semibold text-[#223750]">Allow fallback providers if the selected model is unavailable.</span> Your document is sent to the selected external provider; with this enabled, it may also be sent to the next available provider so the run can finish. Turn it off to keep the document with the selected provider only.</span></label>}
               <label className="block"><span className="mb-2 block text-sm font-semibold">Target word length <span className="font-normal text-[#64748b]">(optional)</span></span><input value={!targetWords.trim() && defaultTargetWords(portal.id) ? defaultTargetWords(portal.id) : targetWords} onChange={(event) => setTargetWords(event.target.value)} inputMode="numeric" className="h-11 w-full rounded-md border border-[#b9c8db] px-3 text-sm outline-none" placeholder="e.g. 3000" /></label>
               <button disabled={busy || !canRun} onClick={() => run()} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#1e64c8] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1956aa] disabled:cursor-not-allowed disabled:opacity-50"><Play className="size-4" />{busy ? "Writing live…" : portal.action}</button>
               {!busy && savedDraft?.active === active && (savedDraft.output.trim() || savedDraft.skeleton.trim()) && <button type="button" onClick={() => run({ resume: true })} className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-[#1e64c8] bg-white px-4 py-2.5 text-sm font-semibold text-[#1e64c8] hover:bg-[#eef5ff]"><Repeat2 className="size-4" />Resume saved draft · {countWords(savedDraft.output).toLocaleString()} words</button>}
               {(busy || output || runFailed) && <div aria-live="polite" className="rounded-lg border border-[#bfd2f1] bg-[#f5f9ff] p-3"><div className="mb-2 flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-[.12em] text-[#1e64c8]"><span>Live output</span><span className="font-normal normal-case tracking-normal text-[#64748b]">{busy ? streamProgress || "Receiving now" : runFailed ? "Run failed" : streamProgress.startsWith("Saved and stopped") ? streamProgress : "Complete"}</span></div><div className="max-h-44 overflow-auto whitespace-pre-wrap font-sans text-sm leading-6 text-[#24334a]">{cleanDocumentText(output) || streamProgress || "Waiting for the first words…"}</div></div>}
            </div>
          </div>
        </section>

        {(output || skeleton || busy) && <section className="mt-7 rounded-xl border border-[#dce1e9] bg-white p-5 shadow-sm lg:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-xs font-bold uppercase tracking-[.14em] text-[#1e64c8]">Result</p><h2 className="mt-1 text-xl font-bold">{portal.title}</h2></div>
            {output.trim() && <div className="flex flex-wrap gap-2">
              {portal.id === "coherence" && !coherenceImproved && <button disabled={busy} onClick={improveCoherence} className="inline-flex items-center gap-2 rounded-md bg-[#1e64c8] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1956aa] disabled:opacity-50"><Sparkles className="size-3.5" />Improve coherence</button>}
              {renderTransferControls()}
              <button disabled={!output.trim()} onClick={portal.id === "coherence" ? copyCoherenceReport : copyOutput} className="inline-flex items-center gap-2 rounded-md border border-[#b9c8db] bg-white px-3 py-2 text-xs font-semibold text-[#205cae] hover:bg-[#eef5ff] disabled:cursor-not-allowed disabled:opacity-50"><Copy className="size-3.5" />{copiedOutput ? "Copied" : portal.id === "coherence" ? "Copy report" : "Copy document"}</button>
              <button disabled={!output.trim()} onClick={portal.id === "coherence" ? downloadCoherenceReport : downloadOutput} className="inline-flex items-center gap-2 rounded-md border border-[#b9c8db] bg-white px-3 py-2 text-xs font-semibold text-[#205cae] hover:bg-[#eef5ff] disabled:cursor-not-allowed disabled:opacity-50"><Download className="size-3.5" />Download .txt</button>
            </div>}
          </div>
          {portal.id === "coherence" && <div className="mt-5"><CoherenceScorecardPanel scorecard={visibleScorecard} requestedProvider={model} evidenceProviders={evidenceProviders} skeletonProviderUsed={skeletonProviderUsed} auditProviderUsed={coherenceProviderUsed} busy={busy} /></div>}
          {portal.id === "coherence" && evidenceProgress && busy && <p className="mt-3 text-xs font-medium text-[#56647a]">{evidenceProgress}</p>}
          {skeleton && <details className="mt-5 rounded-lg bg-[#f5f7fa] p-4"><summary className="cursor-pointer text-sm font-semibold">View extracted skeleton</summary><div className="mt-3 whitespace-pre-wrap font-sans text-xs leading-5 text-[#46566e]">{cleanDocumentText(skeleton)}</div></details>}
          <div className="mt-5 max-h-[640px] overflow-auto whitespace-pre-wrap rounded-lg border border-[#e5e9ef] bg-[#fbfdff] p-4 font-sans text-[15px] leading-7 text-[#24334a]">{(portal.id === "coherence" ? cleanCoherenceText(output) : cleanDocumentText(output)) || (busy ? "Writing the first section…" : "")}</div>
        </section>}
        </div>
      </main>
      {showStreamModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0d1b2acc] p-3 sm:p-8" role="dialog" aria-modal="true" aria-label={`${portal.title} live output`}>
        <div className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
          <div className="flex items-center justify-between gap-4 border-b border-[#dce1e9] px-5 py-4 sm:px-7">
            <div><p className="text-xs font-bold uppercase tracking-[.14em] text-[#1e64c8]">Live document</p><h2 className="mt-1 text-lg font-bold">{portal.title}</h2></div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {busy && (output.trim() || skeleton.trim()) && <button type="button" onClick={saveAndStop} className="inline-flex items-center gap-2 rounded-md border border-[#d49a31] bg-[#fff8e8] px-3 py-2 text-xs font-semibold text-[#855b08] hover:bg-[#fff1cc]"><Save className="size-3.5" />Save and stop</button>}
              {!busy && savedDraft?.active === active && (savedDraft.output.trim() || savedDraft.skeleton.trim()) && <button type="button" onClick={() => run({ resume: true })} className="inline-flex items-center gap-2 rounded-md bg-[#1e64c8] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1956aa]"><Repeat2 className="size-3.5" />Resume saved</button>}
              {renderTransferControls()}
              {portal.id === "coherence" && output.trim() && !coherenceImproved && <button disabled={busy} onClick={improveCoherence} className="inline-flex items-center gap-2 rounded-md bg-[#1e64c8] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1956aa] disabled:opacity-50"><Sparkles className="size-3.5" />Improve coherence</button>}
              {output.trim() && <><button onClick={portal.id === "coherence" && !coherenceImproved ? copyCoherenceReport : copyOutput} className="inline-flex items-center gap-2 rounded-md border border-[#b9c8db] bg-white px-3 py-2 text-xs font-semibold text-[#205cae] hover:bg-[#eef5ff]"><Copy className="size-3.5" />{copiedOutput ? "Copied" : portal.id === "coherence" && !coherenceImproved ? "Copy report" : "Copy document"}</button><button onClick={portal.id === "coherence" && !coherenceImproved ? downloadCoherenceReport : downloadOutput} className="inline-flex items-center gap-2 rounded-md border border-[#b9c8db] bg-white px-3 py-2 text-xs font-semibold text-[#205cae] hover:bg-[#eef5ff]"><Download className="size-3.5" />Download .txt</button></>}
              <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${busy ? "bg-[#eaf2ff] text-[#1e64c8]" : runFailed ? "bg-[#fff0ed] text-[#b53c1f]" : streamProgress.startsWith("Saved and stopped") ? "bg-[#fff3d6] text-[#855b08]" : "bg-[#e8f7ee] text-[#16703a]"}`}>{busy ? streamProgress || "Writing live…" : runFailed ? "Run failed" : streamProgress.startsWith("Saved and stopped") ? streamProgress : "Complete"}</span><button onClick={() => setShowStreamModal(false)} className="rounded-md p-2 text-[#56647a] hover:bg-[#f1f4f8]" aria-label="Close live document"><X className="size-5" /></button>
            </div>
          </div>
          <div className="flex-1 overflow-auto bg-[#fbfdff] px-5 py-6 sm:px-10 sm:py-8">
            {portal.id === "coherence" && <div className="mb-7"><CoherenceScorecardPanel scorecard={visibleScorecard} requestedProvider={model} evidenceProviders={evidenceProviders} skeletonProviderUsed={skeletonProviderUsed} auditProviderUsed={coherenceProviderUsed} busy={busy} /></div>}
            {portal.id === "coherence" && evidenceProgress && busy && <p className="mb-5 text-xs font-medium text-[#56647a]">{evidenceProgress}</p>}
            {skeleton && <details open={!output.trim()} className="mb-7 rounded-lg border border-[#dce1e9] bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">{busy ? "Live global outline" : "View global outline"}</summary><div className="mt-3 whitespace-pre-wrap font-sans text-sm leading-6 text-[#56647a]">{cleanDocumentText(skeleton)}</div></details>}
            <div data-testid="live-document-text" aria-live="polite" className="whitespace-pre-wrap font-sans text-[16px] leading-8 text-[#24334a]">{(portal.id === "coherence" ? cleanCoherenceText(output) : cleanDocumentText(output)) || (busy ? streamProgress || "Preparing the first streamed section…" : runFailed ? streamProgress : "No output was returned.")}</div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#dce1e9] px-5 py-3 text-xs text-[#64748b] sm:px-7"><span>Text is delivered continuously as each model token arrives. You can close this window; the result remains available below.</span><span data-testid="live-word-count" className="font-semibold text-[#46566e]">{countWords(output).toLocaleString()} generated words</span></div>
        </div>
      </div>}
    </div>
  );
}