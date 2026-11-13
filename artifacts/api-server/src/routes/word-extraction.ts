import { Router, type IRouter } from "express";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { ExtractWordDocumentBody, ExtractWordDocumentResponse } from "@workspace/api-zod";

const router: IRouter = Router();
router.post("/documents/word", async (req, res): Promise<void> => {
  const parsed = ExtractWordDocumentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Provide a DOC or DOCX file up to 10 MB." }); return; }
  const { fileName, base64 } = parsed.data;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) { res.status(400).json({ error: "Invalid document encoding." }); return; }
  const buffer = Buffer.from(base64, "base64");
  const docx = /\.docx$/i.test(fileName), doc = /\.doc$/i.test(fileName);
  if (!buffer.length || buffer.length > 10 * 1024 * 1024 || (!docx && !doc)) { res.status(400).json({ error: "Use a DOC or DOCX file up to 10 MB." }); return; }
  try {
    let text: string;
    if (docx) {
      if (buffer.readUInt16LE(0) !== 0x4b50) throw new Error("Not a DOCX file.");
      // Bound advertised ZIP expansion before the DOCX parser opens the archive.
      let expanded = 0, entries = 0;
      for (let i = 0; i + 46 <= buffer.length; i++) {
        if (buffer.readUInt32LE(i) !== 0x02014b50) continue;
        expanded += buffer.readUInt32LE(i + 24); entries++;
        if (expanded > 30 * 1024 * 1024 || entries > 5000) throw new Error("DOCX contents are too large. Export a smaller TXT file.");
        i += 45 + buffer.readUInt16LE(i + 28) + buffer.readUInt16LE(i + 30) + buffer.readUInt16LE(i + 32);
      }
      if (!entries) throw new Error("DOCX archive is invalid.");
      text = (await mammoth.extractRawText({ buffer })).value;
    } else {
      if (buffer.subarray(0, 8).toString("hex") !== "d0cf11e0a1b11ae1") throw new Error("Not a DOC file.");
      text = (await new WordExtractor().extract(buffer)).getBody();
    }
    if (!text.trim() || Buffer.byteLength(text) > 30 * 1024 * 1024) throw new Error("No readable text, or the extracted text is too large.");
    res.setHeader("Cache-Control", "no-store");
    res.json(ExtractWordDocumentResponse.parse({ text }));
  } catch (err) {
    req.log.warn({ error: err instanceof Error ? err.message : "Document parse failed" }, "Word document extraction failed");
    res.status(422).json({ error: "Could not read this Word document. It may be invalid, encrypted or too large when expanded. Export it as TXT or PDF and try again." });
  }
});
export default router;
