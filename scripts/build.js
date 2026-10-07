// Assembles the website in _site/: the files in public/ plus the browser
// libraries copied from node_modules. GitHub Pages publishes this folder.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

rmSync("_site", { recursive: true, force: true });
cpSync("public", "_site", { recursive: true });
mkdirSync("_site/vendor");
cpSync("node_modules/@mlc-ai/web-llm/lib/index.js", "_site/vendor/web-llm.js");
cpSync("node_modules/marked/lib/marked.umd.js", "_site/vendor/marked.js");
cpSync("node_modules/dompurify/dist/purify.min.js", "_site/vendor/purify.js");

// Photo reading (OCR): Tesseract, its engine, and English/French/Spanish data.
mkdirSync("_site/vendor/tesseract/core", { recursive: true });
mkdirSync("_site/vendor/tesseract/lang");
cpSync("node_modules/tesseract.js/dist/tesseract.esm.min.js", "_site/vendor/tesseract/tesseract.esm.js");
cpSync("node_modules/tesseract.js/dist/worker.min.js", "_site/vendor/tesseract/worker.min.js");
for (const file of readdirSync("node_modules/tesseract.js-core").filter((f) => f.endsWith("lstm.wasm.js"))) {
  cpSync(`node_modules/tesseract.js-core/${file}`, `_site/vendor/tesseract/core/${file}`);
}
for (const lang of ["eng", "fra", "spa"]) {
  cpSync(`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`, `_site/vendor/tesseract/lang/${lang}.traineddata.gz`);
}

// Stamp every file reference with a version so browsers never mix files from
// an old publish with a new one (GitHub Pages lets browsers reuse files for
// about 10 minutes, which otherwise breaks the page right after an update).
const version = (process.env.GITHUB_SHA || Date.now().toString(36)).slice(0, 8);

const html = readFileSync("_site/index.html", "utf8").replace(
  /((?:src|href)=")((?!https?:|#|data:)[^"?]+\.(?:js|css|svg))"/g,
  `$1$2?v=${version}"`,
);
writeFileSync("_site/index.html", html);

const jsFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "vendor" ? [] : jsFiles(full);
    return entry.name.endsWith(".js") ? [full] : [];
  });

for (const file of jsFiles("_site")) {
  const code = readFileSync(file, "utf8").replace(
    /((?:from\s*|import\s*\(\s*|new URL\(\s*)["'])(\.{1,2}\/[^"'?]+\.js)(["'])/g,
    `$1$2?v=${version}$3`,
  );
  writeFileSync(file, code);
}

console.log(`Built the site in _site/ (version ${version})`);
