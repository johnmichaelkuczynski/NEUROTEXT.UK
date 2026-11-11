import { Fragment, useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

export function MathText({ text }: { text: string }) {
  const pieces = useMemo(() => {
    // Recognize both Mathpix's native delimiters and conventional dollar math.
    // Unclosed delimiters during streaming remain visible until completed.
    const pattern = /\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$|(?<![\\\w])\$([^\s$](?:[^$\n]*?[^\s$])?)\$(?!\d)/g;
    const parts: { text: string; html?: string; display?: boolean }[] = [];
    let end = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index! > end) parts.push({ text: text.slice(end, match.index) });
      const formula = match[1] ?? match[2] ?? match[3] ?? match[4];
      const display = match[2] !== undefined || match[3] !== undefined;
      try {
        parts.push({ text: match[0], display, html: katex.renderToString(formula, {
          displayMode: display, throwOnError: true, trust: false,
          strict: 'ignore', maxExpand: 1000, maxSize: 20, output: 'htmlAndMathml',
        }) });
      } catch {
        parts.push({ text: match[0] }); // Preserve unsupported or incomplete notation; never drop content.
      }
      end = match.index! + match[0].length;
    }
    if (end < text.length) parts.push({ text: text.slice(end) });
    return parts;
  }, [text]);
  return <>{pieces.map((piece, index) => piece.html
    ? <span key={index} className={piece.display ? 'block overflow-x-auto my-4' : 'inline'} dangerouslySetInnerHTML={{ __html: piece.html }} />
    : <Fragment key={index}>{piece.text}</Fragment>)}</>;
}
