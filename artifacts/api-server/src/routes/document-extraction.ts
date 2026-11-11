import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  ExtractDocumentBody, ExtractDocumentResponse,
  GetDocumentExtractionParams, GetDocumentExtractionResponse,
} from "@workspace/api-zod";
import { decodeOcrFile, extractMathpixImage, MathpixError, readMathpixPdf, submitMathpixPdf } from "../services/mathpix";

const router: IRouter = Router();
type Job = { session: string; providerId: string; expires: number; text?: string };
const jobs = new Map<string, Job>();
function prune() {
  for (const [id, job] of jobs) if (job.expires < Date.now()) jobs.delete(id);
}

router.post("/documents/extract", async (req, res): Promise<void> => {
  const parsed = ExtractDocumentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Upload a PNG, JPEG, WebP, GIF or PDF no larger than 10 MB." }); return; }
  try {
    const { fileName, mimeType, base64 } = parsed.data;
    const file = decodeOcrFile(base64, mimeType);
    if (mimeType === "application/pdf") {
      prune();
      const session = req.cookies.neurotext_session as string;
      if (jobs.size >= 20 || [...jobs.values()].filter(job => job.session === session && !job.text).length >= 2) {
        res.status(429).json({ error: "Wait for the current PDF uploads to finish before uploading another." }); return;
      }
      const providerId = await submitMathpixPdf(file, fileName);
      const jobId = randomUUID();
      jobs.set(jobId, { session, providerId, expires: Date.now() + 30 * 60 * 1000 });
      res.json(ExtractDocumentResponse.parse({ status: "processing", provider: "Mathpix", jobId }));
    } else {
      const text = await extractMathpixImage(file, mimeType, fileName);
      res.json(ExtractDocumentResponse.parse({ status: "complete", provider: "Mathpix", text }));
    }
  } catch (error) {
    const known = error instanceof MathpixError;
    req.log.warn({ status: known ? error.status : 502 }, "Mathpix extraction failed");
    res.status(known ? error.status : 502).json({ error: known ? error.message : "Mathpix extraction timed out or could not connect. Please try again." });
  }
});

router.get("/documents/extract/:jobId", async (req, res): Promise<void> => {
  prune();
  const parsed = GetDocumentExtractionParams.safeParse(req.params);
  const job = parsed.success ? jobs.get(parsed.data.jobId) : undefined;
  if (!job || job.session !== req.cookies.neurotext_session) {
    res.status(404).json({ error: "This PDF upload expired or is unavailable. Upload the file again." }); return;
  }
  try {
    const text = job.text || await readMathpixPdf(job.providerId);
    if (text) job.text = text;
    res.setHeader("Cache-Control", "no-store");
    res.json(GetDocumentExtractionResponse.parse(text
      ? { status: "complete", provider: "Mathpix", text }
      : { status: "processing", provider: "Mathpix", jobId: parsed.success ? parsed.data.jobId : "" }));
  } catch (error) {
    const known = error instanceof MathpixError;
    req.log.warn({ status: known ? error.status : 502 }, "Mathpix PDF result failed");
    res.status(known ? error.status : 502).json({ error: known ? error.message : "Could not retrieve the Mathpix PDF result. Please retry." });
  }
});

export default router;
