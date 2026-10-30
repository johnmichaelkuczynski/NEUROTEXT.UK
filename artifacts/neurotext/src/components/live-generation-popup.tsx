import { useEffect, useRef, useState, type PointerEvent } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  text: string;
  busy: boolean;
  status: string;
  title?: string;
};

export default function LiveGenerationPopup({ open, onClose, text, busy, status, title = "Live output" }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 70 });
  const [size, setSize] = useState({ width: 720, height: 480 });
  const [visible, setVisible] = useState("");
  const visibleRef = useRef("");
  const target = useRef({ text, busy });
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const gesture = useRef<{ kind: "move" | "resize"; x: number; y: number; left: number; top: number; width: number; height: number } | null>(null);
  target.current = { text, busy };

  useEffect(() => {
    if (busy) {
      setCollapsed(false);
      follow.current = true;
    }
  }, [busy]);

  useEffect(() => {
    const fit = () => {
      setSize((s) => ({ width: Math.min(s.width, window.innerWidth - 24), height: Math.min(s.height, window.innerHeight - 40) }));
      setPosition((p) => ({
        x: Math.max(0, Math.min(p.x, window.innerWidth - 80)),
        y: Math.max(0, Math.min(p.y, window.innerHeight - 60)),
      }));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    // Reveal only words already received from the model. Never invent a stream.
    const timer = window.setInterval(() => {
      const current = target.current;
      let shown = visibleRef.current;
      if (!current.text.startsWith(shown)) shown = "";
      const remaining = current.text.slice(shown.length);
      const nextWord = remaining.match(/^\s*\S+\s+/)?.[0];
      const next = nextWord ? shown + nextWord : !current.busy ? current.text : shown;
      if (visibleRef.current !== next) {
        visibleRef.current = next;
        setVisible(next);
      }
    }, 16);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [visible, collapsed, open]);

  const begin = (event: PointerEvent<HTMLElement>, kind: "move" | "resize") => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { kind, x: event.clientX, y: event.clientY, left: position.x, top: position.y, ...size };
  };

  const move = (event: PointerEvent<HTMLElement>) => {
    const start = gesture.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (start.kind === "move") {
      setPosition({
        x: Math.max(0, Math.min(start.left + dx, window.innerWidth - size.width)),
        y: Math.max(0, Math.min(start.top + dy, window.innerHeight - (collapsed ? 60 : size.height))),
      });
    } else {
      setSize({
        width: Math.max(Math.min(280, window.innerWidth - 24), Math.min(start.width + dx, window.innerWidth - position.x - 12)),
        height: Math.max(Math.min(180, window.innerHeight - 24), Math.min(start.height + dy, window.innerHeight - position.y - 12)),
      });
    }
  };

  const end = () => { gesture.current = null; };
  if (!open) return null;

  return (
    <section
      role="dialog"
      aria-label={title}
      aria-modal="false"
      className="fixed z-50 flex flex-col overflow-hidden rounded-lg border border-slate-400 bg-white text-slate-900 shadow-2xl"
      style={{ left: position.x, top: position.y, width: size.width, height: collapsed ? "auto" : size.height, maxWidth: "calc(100vw - 12px)", maxHeight: "calc(100dvh - 12px)" }}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-100 p-2">
        <div
          tabIndex={0}
          aria-label="Move live output window. Drag or use arrow keys."
          className="min-w-0 flex-1 touch-none cursor-move px-2 py-1 font-semibold"
          onPointerDown={(event) => begin(event, "move")}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={(event) => {
            const directions: Record<string, [number, number]> = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
            const delta = directions[event.key];
            if (!delta) return;
            event.preventDefault();
            setPosition((p) => ({ x: Math.max(0, Math.min(p.x + delta[0], window.innerWidth - size.width)), y: Math.max(0, Math.min(p.y + delta[1], window.innerHeight - (collapsed ? 60 : size.height))) }));
          }}
        >{title}</div>
        <button type="button" className="rounded border border-slate-300 bg-white px-2 py-1 text-sm" aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}>{collapsed ? "Expand" : "Collapse"}</button>
        <button type="button" className="rounded border border-slate-300 bg-white px-2 py-1 text-sm" onClick={onClose}>Hide</button>
      </div>
      <p role="status" className="shrink-0 px-4 py-2 text-sm text-slate-600">{status || (busy ? "Writing…" : "Complete")}</p>
      {!collapsed && (
        <>
          <div
            ref={scroll}
            aria-label="Streaming text"
            className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-4 pb-7 text-base leading-7"
            onScroll={() => {
              const element = scroll.current;
              if (element) follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 70;
            }}
          >{visible || (busy ? "Waiting for the first words…" : "No text received.")}</div>
          <button
            type="button"
            aria-label="Resize live output window. Drag or use arrow keys."
            className="absolute bottom-0 right-0 h-7 w-7 touch-none cursor-se-resize text-lg text-slate-600"
            onPointerDown={(event) => begin(event, "resize")}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onKeyDown={(event) => {
              if (!event.key.startsWith("Arrow")) return;
              event.preventDefault();
              setSize((s) => ({
                width: Math.max(260, Math.min(s.width + (event.key === "ArrowRight" ? 20 : event.key === "ArrowLeft" ? -20 : 0), window.innerWidth - position.x - 12)),
                height: Math.max(160, Math.min(s.height + (event.key === "ArrowDown" ? 20 : event.key === "ArrowUp" ? -20 : 0), window.innerHeight - position.y - 12)),
              }));
            }}
          >◢</button>
        </>
      )}
    </section>
  );
}
