import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import {
  CreateLibraryDocumentBody, CreateLibraryDocumentResponse,
  GetLibraryDocumentParams, GetLibraryDocumentResponse,
  DeleteLibraryDocumentParams, ListLibraryResponse,
  GetHistoryWorkParams, GetHistoryWorkResponse, ListHistoryResponse, DeleteHistoryWorkParams,
} from "@workspace/api-zod";
import { privateAccount, privateWrite, userId } from "../services/account-session";
import { libraryCharge, MAX_LIBRARY_BYTES, MAX_LIBRARY_PAGES } from "../services/library-limits";

const router: IRouter = Router();
const documentColumns = `id, title, format, word_count AS "wordCount", pages,
  charged_pages AS "chargedPages", charged_bytes AS "chargedBytes", created_at AS "createdAt"`;
const historyColumns = `id, function_id AS "functionId", title, word_count AS "wordCount", created_at AS "createdAt"`;
const dates = (row: any) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() });
router.use(["/library", "/history"], privateAccount);
router.get("/library", async (req, res): Promise<void> => {
  const { rows } = await pool.query(`SELECT ${documentColumns} FROM neurotext_library WHERE user_id=$1 ORDER BY created_at DESC`, [userId(req)]);
  res.json(ListLibraryResponse.parse({
    documents: rows.map(dates),
    usedPages: rows.reduce((n, r) => n + r.chargedPages, 0),
    usedBytes: rows.reduce((n, r) => n + r.chargedBytes, 0),
    maxPages: MAX_LIBRARY_PAGES, maxBytes: MAX_LIBRARY_BYTES,
  }));
});
router.post("/library", privateWrite, async (req, res): Promise<void> => {
  const parsed = CreateLibraryDocumentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Provide a title, nonempty extracted text, a valid format and original file size." }); return; }
  const input = parsed.data;
  if (!input.text.trim() || !input.title.trim() || input.text.includes("\0")) { res.status(400).json({ error: "Upload a document containing readable text and a title." }); return; }
  const charge = libraryCharge(input.text, input.format, input.originalBytes);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Lock the owner row so simultaneous uploads cannot exceed their quota.
    const owner = await client.query("SELECT id FROM neurotext_users WHERE id=$1 FOR UPDATE", [userId(req)]);
    if (!owner.rowCount) { await client.query("ROLLBACK"); res.status(401).json({ error: "Your account is unavailable. Sign in again." }); return; }
    const { rows: [used] } = await client.query(`SELECT COALESCE(SUM(charged_pages),0)::bigint AS pages, COALESCE(SUM(charged_bytes),0)::bigint AS bytes FROM neurotext_library WHERE user_id=$1`, [userId(req)]);
    if (Number(used.pages) + charge.chargedPages > MAX_LIBRARY_PAGES || Number(used.bytes) + charge.chargedBytes > MAX_LIBRARY_BYTES) {
      await client.query("ROLLBACK");
      res.status(413).json({ error: "This upload exceeds your private library allowance: 10,000 weighted pages or 50 MiB of weighted storage. TXT counts 1×, DOC/DOCX 2× and PDF/images 4×. Delete documents or upload a smaller text." }); return;
    }
    const { rows: [row] } = await client.query(
      `INSERT INTO neurotext_library (id,user_id,title,text,format,word_count,pages,charged_pages,charged_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${documentColumns}`,
      [randomUUID(), userId(req), input.title.trim(), input.text, input.format, charge.words, charge.pages, charge.chargedPages, charge.chargedBytes]);
    await client.query("COMMIT");
    res.status(201).json(CreateLibraryDocumentResponse.parse(dates(row)));
  } catch (err) {
    await client.query("ROLLBACK"); throw err;
  } finally { client.release(); }
});
router.get("/library/:documentId", async (req, res): Promise<void> => {
  const parsed = GetLibraryDocumentParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid document identifier." }); return; }
  const { rows: [row] } = await pool.query(`SELECT ${documentColumns}, text FROM neurotext_library WHERE id=$1 AND user_id=$2`, [parsed.data.documentId, userId(req)]);
  if (!row) { res.status(404).json({ error: "Document not found." }); return; }
  res.json(GetLibraryDocumentResponse.parse(dates(row)));
});
router.delete("/library/:documentId", privateWrite, async (req, res): Promise<void> => {
  const parsed = DeleteLibraryDocumentParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid document identifier." }); return; }
  const result = await pool.query("DELETE FROM neurotext_library WHERE id=$1 AND user_id=$2", [parsed.data.documentId, userId(req)]);
  if (!result.rowCount) { res.status(404).json({ error: "Document not found." }); return; }
  res.json({ ok: true });
});
router.get("/history", async (req, res): Promise<void> => {
  const { rows } = await pool.query(`SELECT ${historyColumns} FROM neurotext_history WHERE user_id=$1 ORDER BY created_at DESC`, [userId(req)]);
  res.json(ListHistoryResponse.parse(rows.map(dates)));
});
router.get("/history/:historyId", async (req, res): Promise<void> => {
  const parsed = GetHistoryWorkParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid work identifier." }); return; }
  const { rows: [row] } = await pool.query(`SELECT ${historyColumns}, payload FROM neurotext_history WHERE id=$1 AND user_id=$2`, [parsed.data.historyId, userId(req)]);
  if (!row) { res.status(404).json({ error: "Work not found." }); return; }
  const { payload, ...metadata } = row;
  res.json(GetHistoryWorkResponse.parse({ ...dates(metadata), workspace: { ...payload, functionId: row.functionId, updatedAt: new Date(row.createdAt).toISOString() } }));
});
router.delete("/history/:historyId", privateWrite, async (req, res): Promise<void> => {
  const parsed = DeleteHistoryWorkParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid work identifier." }); return; }
  const result = await pool.query("DELETE FROM neurotext_history WHERE id=$1 AND user_id=$2", [parsed.data.historyId, userId(req)]);
  if (!result.rowCount) { res.status(404).json({ error: "Work not found." }); return; }
  res.json({ ok: true });
});
export default router;
