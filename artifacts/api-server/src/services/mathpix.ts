const API = "https://api.mathpix.com/v3";
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export class MathpixError extends Error {
  status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}

function headers(): Record<string, string> {
  const key = process.env.MATHPIX_API_KEY;
  const id = process.env.MATHPIX_API_ID;
  if (!key || !id) throw new MathpixError("Mathpix OCR requires MATHPIX_API_KEY and MATHPIX_API_ID on the server. Plain-text uploads and equation display still work without them.", 503);
  return { app_key: key, app_id: id };
}

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init, headers: { ...headers(), ...init.headers },
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) {
    // Do not expose response bodies or request headers containing credentials.
    if (response.status === 401 || response.status === 403) throw new MathpixError("Mathpix rejected the credentials. Check MATHPIX_API_KEY and MATHPIX_API_ID.");
    if (response.status === 429) throw new MathpixError("Mathpix's request or account limit was reached. Check the Mathpix account allowance.", 429);
    throw new MathpixError(`Mathpix could not process this file (HTTP ${response.status}).`);
  }
  return response;
}

function checkedText(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new MathpixError("Mathpix returned no readable text. Try a clearer image or another document.", 422);
  if (Buffer.byteLength(value, "utf8") > MAX_FILE_BYTES) throw new MathpixError("The extracted document exceeds the 10 MB text limit.", 413);
  return value.trim();
}

async function jsonObject(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MathpixError("Mathpix returned an invalid response.");
  return value as Record<string, unknown>;
}

export function decodeOcrFile(base64: string, mimeType: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) throw new MathpixError("The uploaded file is not valid base64.", 400);
  const file = Buffer.from(base64, "base64");
  if (!file.length || file.length > MAX_FILE_BYTES) throw new MathpixError("Upload a nonempty file no larger than 10 MB.", 413);
  const signature = file.subarray(0, 12);
  const matches =
    (mimeType === "application/pdf" && file.subarray(0, 1024).includes(Buffer.from("%PDF-"))) ||
    (mimeType === "image/png" && signature.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ||
    (mimeType === "image/jpeg" && signature[0] === 255 && signature[1] === 216 && signature[2] === 255) ||
    (mimeType === "image/gif" && /^GIF8[79]a/.test(signature.toString("ascii"))) ||
    (mimeType === "image/webp" && signature.toString("ascii",0,4) === "RIFF" && signature.toString("ascii",8,12) === "WEBP");
  if (!matches) throw new MathpixError("The file contents do not match a supported PDF or image format.", 400);
  return file;
}

const options = {
  math_inline_delimiters: ["\\(", "\\)"],
  math_display_delimiters: ["\\[", "\\]"],
  idiomatic_eqn_arrays: true,
  metadata: { improve_mathpix: false },
};

export async function extractMathpixImage(file: Buffer, mimeType: string, fileName: string): Promise<string> {
  // Multipart avoids the provider's smaller base64-image limit.
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file)], { type: mimeType }), fileName);
  form.append("options_json", JSON.stringify({ ...options, formats: ["text"], enable_document_layout: true }));
  const result = await jsonObject(await request("/text", { method: "POST", body: form }));
  if (result.error || result.error_info) throw new MathpixError("Mathpix could not recognize this image. Try a clearer image or check the account allowance.", 422);
  return checkedText(result.text);
}

export async function submitMathpixPdf(file: Buffer, fileName: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file)], { type: "application/pdf" }), fileName);
  form.append("options_json", JSON.stringify(options));
  const result = await jsonObject(await request("/pdf", { method: "POST", body: form }));
  if (typeof result.pdf_id !== "string" || !/^[\w-]+$/.test(result.pdf_id)) throw new MathpixError("Mathpix did not accept this PDF.");
  return result.pdf_id;
}

export async function readMathpixPdf(id: string): Promise<string | null> {
  const result = await jsonObject(await request(`/pdf/${encodeURIComponent(id)}`));
  if (result.status === "error" || result.error || result.error_info) throw new MathpixError("Mathpix could not process this PDF. Check that the document is readable and the account has available credit.", 422);
  if (result.status !== "completed") return null;
  const output = await request(`/pdf/${encodeURIComponent(id)}.mmd`);
  return checkedText(await output.text());
}
