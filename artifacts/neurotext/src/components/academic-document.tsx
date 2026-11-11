interface AcademicDocumentProps {
  text: string;
}

// The academic generator emits plain-text section boundaries, so copy/download
// and the rendered document share the same title, contents and chapter order.
export function AcademicDocument({ text }: AcademicDocumentProps) {
  const paragraphs = text.split(/\n\s*\n/);
  return (
    <>
      {paragraphs.map((paragraph, index) => {
        const value = paragraph.trim();
        if (!value) return null;
        if (index === 0) return <h1 key={index} className="text-2xl font-bold mb-8">{value}</h1>;
        if (value === 'Table of Contents') return <h2 key={index} className="text-xl font-bold mt-8 mb-4">{value}</h2>;
        if (paragraphs[index - 1]?.trim() === 'Table of Contents') {
          return (
            <nav key={index} aria-label="Table of contents" className="not-prose mb-10">
              <ol className="space-y-2 list-none pl-0">
                {value.split('\n').filter(Boolean).map((line, lineIndex) => {
                  const chapter = line.match(/^Chapter (\d+):/);
                  return (
                    <li key={lineIndex}>
                      <a className="text-primary hover:underline" href={chapter ? `#academic-chapter-${chapter[1]}` : '#academic-references'}>
                        {line}
                      </a>
                    </li>
                  );
                })}
              </ol>
            </nav>
          );
        }
        const chapter = value.match(/^Chapter (\d+): ([^\n]+)$/);
        if (chapter) {
          return <h2 key={index} id={`academic-chapter-${chapter[1]}`} className="text-xl font-bold border-t pt-8 mt-12 mb-6 scroll-mt-8">{value}</h2>;
        }
        if (value === 'References') {
          return <h2 key={index} id="academic-references" className="text-xl font-bold border-t pt-8 mt-12 mb-6 scroll-mt-8">{value}</h2>;
        }
        if (/^(?:#{1,6}\s+|\d+\.\d+\s+)[^\n]{1,180}$/.test(value)) {
          return <h3 key={index} className="text-lg font-semibold mt-6 mb-3">{value.replace(/^#{1,6}\s+/, '')}</h3>;
        }
        return <p key={index} className="whitespace-pre-line">{paragraph}</p>;
      })}
    </>
  );
}
