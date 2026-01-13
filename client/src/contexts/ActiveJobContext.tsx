import { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface ActiveJobState {
  jobId: string | null;
  documentId: string | null;
  coherenceMode: string | null;
  isProcessing: boolean;
  phase: string;
  totalChunks: number;
  completedChunks: number;
}

interface ActiveJobContextValue {
  activeJob: ActiveJobState | null;
  setActiveJob: (job: ActiveJobState | null) => void;
  updateActiveJob: (updates: Partial<ActiveJobState>) => void;
  clearActiveJob: () => void;
  viewerOpen: boolean;
  openViewer: () => void;
  closeViewer: () => void;
  viewJobId: string | null;
  viewJob: (documentId: string) => void;
}

const ActiveJobContext = createContext<ActiveJobContextValue | null>(null);

const STORAGE_KEY = 'neurotext_active_job';

function getStoredJob(): ActiveJobState | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function setStoredJob(job: ActiveJobState | null) {
  if (typeof window === 'undefined') return;
  try {
    if (job) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(job));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export function ActiveJobProvider({ children }: { children: React.ReactNode }) {
  const [activeJob, setActiveJobState] = useState<ActiveJobState | null>(getStoredJob);
  
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewJobId, setViewJobId] = useState<string | null>(null);

  useEffect(() => {
    setStoredJob(activeJob);
  }, [activeJob]);

  const setActiveJob = useCallback((job: ActiveJobState | null) => {
    setActiveJobState(job);
  }, []);

  const updateActiveJob = useCallback((updates: Partial<ActiveJobState>) => {
    setActiveJobState(prev => prev ? { ...prev, ...updates } : null);
  }, []);

  const clearActiveJob = useCallback(() => {
    setActiveJobState(null);
    setStoredJob(null);
  }, []);

  const openViewer = useCallback(() => {
    if (activeJob?.documentId) {
      setViewJobId(activeJob.documentId);
    }
    setViewerOpen(true);
  }, [activeJob]);

  const closeViewer = useCallback(() => {
    setViewerOpen(false);
  }, []);

  const viewJob = useCallback((documentId: string) => {
    setViewJobId(documentId);
    setViewerOpen(true);
  }, []);

  return (
    <ActiveJobContext.Provider value={{
      activeJob,
      setActiveJob,
      updateActiveJob,
      clearActiveJob,
      viewerOpen,
      openViewer,
      closeViewer,
      viewJobId,
      viewJob
    }}>
      {children}
    </ActiveJobContext.Provider>
  );
}

export function useActiveJob() {
  const context = useContext(ActiveJobContext);
  if (!context) {
    throw new Error('useActiveJob must be used within ActiveJobProvider');
  }
  return context;
}
