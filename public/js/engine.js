// Runs the AI model inside the browser with WebLLM. The model downloads once
// from Hugging Face, stays in browser storage so Sage opens quickly next time,
// and loads into the device's memory. Nothing the student types leaves the device.
import { CreateWebWorkerMLCEngine, hasModelInCache, deleteModelAllInfoInCache } from "../vendor/web-llm.js";
import { createThinkFilter } from "./think.js";

// The model Sage uses (Qwen2.5 7B, about a 5 GB download). The fast build
// needs the GPU's "shader-f16" feature; the other works on every GPU.
const MODEL = {
  fast: "Qwen2.5-7B-Instruct-q4f16_1-MLC",
  compatible: "Qwen2.5-7B-Instruct-q4f32_1-MLC",
};
export const DOWNLOAD_SIZE = "about 5 GB";

// Smaller models earlier versions of Sage offered. Still cleaned up if found.
const OLD_MODELS = [
  "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  "Qwen2.5-1.5B-Instruct-q4f32_1-MLC",
  "Qwen2.5-3B-Instruct-q4f16_1-MLC",
  "Qwen2.5-3B-Instruct-q4f32_1-MLC",
];

// Returns { ok, fast } or { ok: false, reason }.
export async function checkDevice() {
  if (!navigator.gpu) return { ok: false, reason: "no-webgpu" };
  const adapter = await navigator.gpu.requestAdapter().catch(() => null);
  if (!adapter) return { ok: false, reason: "no-adapter" };
  return { ok: true, fast: adapter.features.has("shader-f16") };
}

const modelIdFor = (fast) => (fast ? MODEL.fast : MODEL.compatible);

export async function isDownloaded(fast) {
  return hasModelInCache(modelIdFor(fast)).catch(() => false);
}

// Deletes stored AI downloads from this device. A model that's already loaded
// keeps working until the tab closes, because it's in memory, not on disk.
//   keepCurrent: leave the model this device uses, removing only old ones
export async function removeDownloads({ keepCurrent = false, fast } = {}) {
  const keepId = keepCurrent ? modelIdFor(fast) : null;
  for (const id of [MODEL.fast, MODEL.compatible, ...OLD_MODELS]) {
    if (id !== keepId) await deleteModelAllInfoInCache(id).catch(() => {});
  }
  if (!keepId && "caches" in self) {
    // Sweep anything else WebLLM stored, such as a half-finished download.
    const names = await caches.keys().catch(() => []);
    await Promise.all(names.filter((n) => n.startsWith("webllm/")).map((n) => caches.delete(n)));
  }
}

// Bytes of storage this site is using on the device, or null if unknown.
export async function storageUsed() {
  try {
    const { usage } = await navigator.storage.estimate();
    return usage ?? null;
  } catch {
    return null;
  }
}

// Loads the model and returns the small interface the tutor uses.
//   onProgress({ progress: 0..1, text })
export async function loadEngine(fast, onProgress = () => {}) {
  const modelId = modelIdFor(fast);
  const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  const engine = await CreateWebWorkerMLCEngine(worker, modelId, {
    initProgressCallback: (report) => onProgress({ progress: report.progress, text: report.text }),
  });

  // Stop generating if the student starts a new topic mid-reply.
  function watch(signal) {
    if (!signal) return () => {};
    const stop = () => engine.interruptGenerate();
    signal.addEventListener("abort", stop);
    return () => signal.removeEventListener("abort", stop);
  }

  return {
    modelId,

    async chat({ messages, maxTokens = 450, signal, onText = () => {} }) {
      const unwatch = watch(signal);
      try {
        const stream = await engine.chat.completions.create({
          messages,
          stream: true,
          temperature: 0.5,
          frequency_penalty: 0.3, // small models like to repeat themselves
          max_tokens: maxTokens,
        });
        const hideThinking = createThinkFilter();
        let full = "";
        for await (const chunk of stream) {
          if (signal?.aborted) break;
          const piece = hideThinking(chunk.choices[0]?.delta?.content || "");
          if (piece) {
            full += piece;
            onText(piece);
          }
        }
        if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
        return full;
      } finally {
        unwatch();
      }
    },

    // Asks for JSON matching `schema`; returns the parsed object or null.
    async json({ messages, schema, signal }) {
      const unwatch = watch(signal);
      try {
        const reply = await engine.chat.completions.create({
          messages,
          temperature: 0,
          max_tokens: 400,
          response_format: { type: "json_object", schema: JSON.stringify(schema) },
        });
        if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
        const text = createThinkFilter()(reply.choices[0]?.message?.content || "");
        try {
          return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
        } catch {
          return null;
        }
      } finally {
        unwatch();
      }
    },
  };
}
