import { MathText } from './math-text';
import { chapterNumber, contentsEntries, normalizeAcademicContents } from '@/lib/academic-formatting';

interface AcademicDocumentProps {
  text: string;
}

// The academic generator emits plain-text section boundaries, so copy/download
// and the rendered document share the same title, contents and chapter order.
export function AcademicDocument({ text }: AcademicDocumentProps) {
  const paragraphs = normalizeAcademicContents(text).split(/\n\s*\n/);
  return (
    <>
      {paragraphs.map((paragraph, index) => {
        const value = paragraph.trim();
        if (!value) return null;
        if (index === 0) return <h1 key={index} className="text-2xl font-bold mb-8"><MathText text={value} /></h1>;
        if (/^Table of Contents$/i.test(value)) return <h2 key={index} className="text-xl font-bold mt-8 mb-4">{value}</h2>;
        if (/^Table of Contents$/i.test(paragraphs[index - 1]?.trim() || '')) {
          return (
            <nav key={index} aria-label="Table of contents" className="not-prose mb-10">
              <ol className="space-y-2 list-none pl-0">
                {contentsEntries(value).map((line, lineIndex) => {
                  const chapter = chapterNumber(line);
                  return (
                    <li key={lineIndex} className="block">
                      <a className="block text-primary hover:underline" href={chapter ? `#academic-chapter-${chapter}` : '#academic-references'}>
                        <MathText text={line} />
                      </a>
                    </li>
                  );
                })}
              </ol>
            </nav>
          );
        }
        const chapter = chapterNumber(value);
        if (chapter && !value.includes('\n') && value.length < 350) {
          return <h2 key={index} id={`academic-chapter-${chapter}`} className="text-xl font-bold border-t pt-8 mt-12 mb-6 scroll-mt-8"><MathText text={value} /></h2>;
        }
        if (value === 'References') {
          return <h2 key={index} id="academic-references" className="text-xl font-bold border-t pt-8 mt-12 mb-6 scroll-mt-8">{value}</h2>;
        }
        if (/^(?:#{1,6}\s+|\d+\.\d+\s+)[^\n]{1,180}$/.test(value)) {
          return <h3 key={index} className="text-lg font-semibold mt-6 mb-3"><MathText text={value.replace(/^#{1,6}\s+/, '')} /></h3>;
        }
        return <p key={index} className="whitespace-pre-line"><MathText text={paragraph} /></p>;
      })}
    </>
  );
}
