import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { contentsEntries, normalizeAcademicContents } from "../artifacts/neurotext/src/lib/academic-formatting.ts";
import { decodeOcrFile, extractMathpixImage, submitMathpixPdf, readMathpixPdf } from "../artifacts/api-server/src/services/mathpix.ts";

const require = createRequire(resolve("artifacts/api-server/package.json"));
const { build } = require("esbuild");
const bundle = await build({
  stdin: {
    contents: `import {createElement} from "react"; import {renderToStaticMarkup} from "react-dom/server"; import {MathText} from "./src/components/math-text"; import {AcademicDocument} from "./src/components/academic-document"; export const renderMath = text => renderToStaticMarkup(createElement(MathText,{text})); export const renderDocument = text => renderToStaticMarkup(createElement(AcademicDocument,{text}));`,
    resolveDir: resolve("artifacts/neurotext"), loader: "tsx",
  },
  bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic", loader: { ".css": "empty" },
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { renderMath, renderDocument } = module.exports;
for (const expression of [String.raw`If \(P\) entails \(Q\).`, String.raw`\[\frac{x^2}{2}=\int_0^x t\,dt\]`, "$x^2$", "$$a+b=c$$"]) {
  assert.ok(renderMath(expression).includes('class="katex"'), expression);
}
assert.ok(renderMath(String.raw`\[x^2\]`).includes("katex-display"));
assert.ok(!renderMath("Costs $20 and $30.").includes('class="katex"'));
assert.ok(renderMath(String.raw`Still streaming \(x^2`).includes(String.raw`\(x^2`));
assert.ok(!renderMath(String.raw`\(\href{javascript:alert(1)}{click}\)`).includes('href="javascript:'));
assert.ok(renderMath("<script>alert(1)</script>").includes("&lt;script&gt;"));
const contents = "Chapter One: Knowledge Chapter Two: Induction Chapter Three: Causation Chapter Four: Explanation Chapter Five: Synthesis";
assert.equal(contentsEntries(contents).length,5);
const legacy = `Theory of Knowledge\n\nTable of Contents\n\n${contents}\n\nChapter One Knowledge\n\nIf \\(P\\) entails \\(Q\\), inference is possible.`;
const html = renderDocument(legacy);
assert.equal((html.match(/<li class="block">/g) || []).length,5);
assert.ok(html.includes('id="academic-chapter-1"'));
assert.ok(html.includes('class="katex"'));
assert.ok(normalizeAcademicContents(legacy).includes("Knowledge\nChapter Two:"));

assert.throws(() => decodeOcrFile(Buffer.from("not a PDF").toString("base64"),"application/pdf"), /contents do not match/);
assert.throws(() => decodeOcrFile("%%%%","image/png"), /valid base64/);
const pdf = Buffer.from("%PDF-1.4\nTest fixture");
assert.deepEqual(decodeOcrFile(pdf.toString("base64"),"application/pdf"),pdf);

const actualFetch = globalThis.fetch;
try {
  let statusCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (url.endsWith("/text")) {
      assert.ok(init.body instanceof FormData);
      const options = JSON.parse(init.body.get("options_json"));
      assert.deepEqual(options.math_inline_delimiters,["\\(","\\)"]);
      assert.equal(options.metadata.improve_mathpix,false);
      return Response.json({text:String.raw`\(x^2+y^2=z^2\)`});
    }
    if (url.endsWith("/pdf")) return Response.json({pdf_id:"test_pdf"});
    if (url.endsWith(".mmd")) return new Response(String.raw`Theory with \(\alpha+\beta\).`);
    statusCalls++;
    return Response.json(statusCalls === 1 ? {status:"processing",percent_done:100} : {status:"completed"});
  };
  assert.equal(await extractMathpixImage(Buffer.from("fixture"),"image/png","math.png"),String.raw`\(x^2+y^2=z^2\)`);
  assert.equal(await submitMathpixPdf(pdf,"math.pdf"),"test_pdf");
  assert.equal(await readMathpixPdf("test_pdf"),null); // 100% is not completion.
  assert.equal(await readMathpixPdf("test_pdf"),String.raw`Theory with \(\alpha+\beta\).`);
  globalThis.fetch = async () => new Response("unauthorized",{status:401});
  await assert.rejects(extractMathpixImage(Buffer.from("fixture"),"image/png","math.png"), /rejected the credentials/);
} finally {
  globalThis.fetch = actualFetch;
}
console.log("PASS: inline/display math, fractions, safe HTML, incomplete streaming notation, five separate legacy contents entries, OCR validation, image multipart options, PDF polling/completion and credential errors. Provider requests were mocked.");
