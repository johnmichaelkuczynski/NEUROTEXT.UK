import { extractDocument, getDocumentExtraction } from '@workspace/api-client-react';
import { readInstructionFile } from './instruction-upload';

export const DOCUMENT_UPLOAD_ACCEPT = '.txt,.md,.markdown,.pdf,.png,.jpg,.jpeg,.webp,.gif,text/plain,text/markdown,application/pdf,image/png,image/jpeg,image/webp,image/gif';
const MIME_BY_EXTENSION: Record<string, 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
};

export async function readDocumentUpload(file: File, signal?: AbortSignal): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const mimeType = MIME_BY_EXTENSION[extension];
  if (!mimeType) return readInstructionFile(file);
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('Upload a nonempty file no larger than 10 MB.');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read this file.'));
    reader.readAsDataURL(file);
  });
  signal?.throwIfAborted();
  let result = await extractDocument({ fileName: file.name, mimeType, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) }, { signal });
  const deadline = Date.now() + 10 * 60 * 1000;
  while (result.status === 'processing') {
    if (!result.jobId) throw new Error('Mathpix did not return a PDF processing identifier.');
    if (Date.now() > deadline) throw new Error('Mathpix is still processing this PDF after 10 minutes. Try a smaller document.');
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException('Upload cancelled', 'AbortError')); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 2000);
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    });
    result = await getDocumentExtraction(result.jobId, { signal });
  }
  if (!result.text?.trim()) throw new Error('Mathpix returned no readable text.');
  return result.text;
}
