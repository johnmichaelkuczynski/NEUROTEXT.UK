import type { Request, Response } from "express";

export type StreamEvent =
  | { type: "status"; status: string; message?: string }
  | { type: "token"; content: string }
  | { type: "progress"; words: number; target: number; percent: number }
  | {
      type: "complete";
      words: number;
      target: number;
      provider: string;
      validated: boolean;
    }
  | { type: "error"; message: string; code: string };

export function createLiveDocumentStream(req: Request, res: Response) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Content-Encoding", "identity");
  res.flushHeaders();
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true, 15_000);
  res.write(`:${" ".repeat(8192)}\n\n`);

  let closed = false;
  const heartbeat = setInterval(() => {
    if (!closed && !res.writableEnded) {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    }
  }, 12_000);

  res.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
  });

  const send = (event: StreamEvent) => {
    if (closed || res.writableEnded) return false;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    return true;
  };

  const finish = () => {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  };

  return {
    send,
    finish,
    isClosed: () => closed || res.writableEnded,
  };
}