import { createHash, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { countWords } from "./library-limits";

export async function recordWork(owner: string | undefined, functionId: number, payload: Record<string, unknown>) {
  const output = typeof payload.output === "string" ? payload.output : "";
  if (!owner || !output.trim()) return;
  const title = output.split("\n").find(line => line.trim())?.replace(/^#+\s*/, "").trim().slice(0, 250) || "Untitled work";
  await pool.query(`INSERT INTO neurotext_history (id,user_id,function_id,title,word_count,content_hash,payload)
    VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (user_id,function_id,content_hash) DO NOTHING`,
    [randomUUID(), owner, functionId, title, countWords(output), createHash("sha256").update(output).digest("hex"), JSON.stringify(payload)]);
}
