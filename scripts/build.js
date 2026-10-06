// Assembles the website in _site/: the files in public/ plus the browser
// libraries copied from node_modules. GitHub Pages publishes this folder.
import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("_site", { recursive: true, force: true });
cpSync("public", "_site", { recursive: true });
mkdirSync("_site/vendor");
cpSync("node_modules/@mlc-ai/web-llm/lib/index.js", "_site/vendor/web-llm.js");
cpSync("node_modules/marked/lib/marked.umd.js", "_site/vendor/marked.js");
cpSync("node_modules/dompurify/dist/purify.min.js", "_site/vendor/purify.js");
console.log("Built the site in _site/");
