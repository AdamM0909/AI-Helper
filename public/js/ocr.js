// Reads the text in a photo of a worksheet (OCR with Tesseract, entirely on
// the device). The text goes into the message box so the student can check
// it before sending. It reads printed text well; it can't understand
// drawings or diagrams.

const base = new URL("../vendor/tesseract/", import.meta.url);
let worker = null;
let workerLangs = "";

// Which languages to read: English, plus the language being studied.
export function ocrLanguages(subject = "") {
  if (/french|français|francais/i.test(subject)) return "eng+fra";
  if (/spanish|español|espanol/i.test(subject)) return "eng+spa";
  return "eng";
}

// Big phone photos are slow to read and no more accurate, so shrink them.
async function prepare(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas;
}

// Tidies OCR output: drops stray symbols and extra blank lines.
export function cleanOcrText(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line === "" || /[\p{L}\p{N}]/u.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

//   onProgress(0..1)
export async function readPhoto(file, subject, onProgress = () => {}) {
  const langs = ocrLanguages(subject);
  let progressHandler = onProgress;
  if (!worker || workerLangs !== langs) {
    await worker?.terminate();
    const { default: Tesseract } = await import("../vendor/tesseract/tesseract.esm.js");
    worker = await Tesseract.createWorker(langs, 1, {
      workerPath: new URL("worker.min.js", base).href,
      corePath: new URL("core", base).href,
      langPath: new URL("lang", base).href,
      gzip: true,
      cacheMethod: "none", // nothing extra stored on the device
      workerBlobURL: false, // the page's security rules only allow workers from this site
      logger: (m) => m.status === "recognizing text" && progressHandler(m.progress),
    });
    workerLangs = langs;
  }
  progressHandler = onProgress;
  const { data } = await worker.recognize(await prepare(file));
  return cleanOcrText(data.text || "");
}
