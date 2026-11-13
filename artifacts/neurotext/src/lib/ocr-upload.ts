import { extractDocument, getDocumentExtraction } from '@workspace/api-client-react';

export type OcrMode = 'mathpix' | 'specialist';
export const OCR_UPLOAD_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.pdf,image/png,image/jpeg,image/webp,image/gif,application/pdf';
export type OcrResult = { text: string; provider: string; warnings: string[] };
const types: Record<string, 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
};
export async function extractOcrUpload(file: File, mode: OcrMode, hint: string, signal?: AbortSignal, onStatus?: (message: string) => void): Promise<OcrResult> {
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('Choose a nonempty image or PDF no larger than 10 MB.');
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const mimeType = Object.values(types).find(type => type === file.type) || types[extension];
  if (!mimeType) throw new Error('OCR accepts PNG, JPEG, WebP, GIF or PDF.');
  if (mode === 'specialist' && mimeType === 'application/pdf') throw new Error('For specialist-script OCR, upload an image or screenshot of the page. Select Mathpix to extract a PDF.');
  if (hint.length > 2000) throw new Error('Keep optional script context below 2,000 characters.');
  signal?.throwIfAborted();
  onStatus?.(mode === 'specialist' ? 'Transcribing the image with OpenAI vision...' : 'Recognizing text and equations with Mathpix...');
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read the uploaded image.'));
    reader.readAsDataURL(file);
  });
  signal?.throwIfAborted();
  let result = await extractDocument({ fileName: file.name.slice(0, 250), mimeType, base64, mode, hint }, { signal });
  const deadline = Date.now() + 10 * 60 * 1000;
  while (result.status === 'processing') {
    if (!result.jobId) throw new Error('The OCR provider did not return a processing identifier.');
    if (Date.now() > deadline) throw new Error('PDF processing exceeded 10 minutes. Try a smaller PDF.');
    onStatus?.('Mathpix is processing the PDF...');
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException('OCR cancelled', 'AbortError')); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 2000);
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    });
    result = await getDocumentExtraction(result.jobId, { signal });
  }
  if (!result.text?.trim()) throw new Error('No readable text was returned. Try a clearer crop.');
  return { text: result.text, provider: result.provider, warnings: result.warnings || ['Review this transcription against the original. OCR may misread symbols, signs or handwriting.'] };
}
