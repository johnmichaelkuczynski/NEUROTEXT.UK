import type { Response } from "express";

type FlushableResponse = Response & { flush?: () => void };

const HEARTBEAT_MS = 1000;

function flush(res: Response) {
  (res as FlushableResponse).flush?.();
}

export function writeLiveDocumentEvent(res: Response, event: Record<string, unknown>) {
  if (res.destroyed || res.writableEnded) return false;
  const accepted = res.write(`${JSON.stringify(event)}\n`);
  flush(res);
  return accepted;
}

export function openLiveDocumentStream(res: Response) {
  res.status(200);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Content-Encoding", "identity");
  res.setHeader("X-Accel-Buffering", "no");
  res.socket?.setNoDelay(true);
  res.socket?.setKeepAlive(true, HEARTBEAT_MS);
  res.flushHeaders();
  writeLiveDocumentEvent(res, { type: "transport_ready" });

  const heartbeat = setInterval(() => {
    if (res.destroyed || res.writableEnded) {
      clearInterval(heartbeat);
      return;
    }
    writeLiveDocumentEvent(res, { type: "heartbeat", at: Date.now() });
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const stopHeartbeat = () => clearInterval(heartbeat);
  res.once("close", stopHeartbeat);
  res.once("finish", stopHeartbeat);
}