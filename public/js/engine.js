// Runs the AI model inside the browser with WebLLM. The model downloads from
// Hugging Face into browser storage, then loads into the device's memory.
// Students can keep the stored copy for fast loading or have Sage delete it
// as soon as it's loaded. Nothing the student types leaves their device.
import { CreateWebWorkerMLCEngine, hasModelInCache, deleteModelAllInfoInCache } from "../vendor/web-llm.js";
import { createThinkFilter } from "./think.js";

// Each size has a fast version (needs the GPU's "shader-f16" feature) and a
// version that works on every GPU.
export const MODEL_SIZES = {
  light: {
    label: "Light",
    detail: "1 GB download, for phones, Chromebooks and older laptops",
    fast: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    compatible: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC",
  },
  standard: {
    label: "Standard",
    detail: "2 GB download, for most laptops",
    fast: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    compatible: "Qwen2.5-3B-Instruct-q4f32_1-MLC",
  },
  strong: {
    label: "Strong",
    detail: "5 GB download, for gaming PCs and newer Macs; teaches best",
    fast: "Qwen2.5-7B-Instruct-q4f16_1-MLC",
    compatible: "Qwen2.5-7B-Instruct-q4f32_1-MLC",
  },
};

// Returns { ok, fast, suggested } or { ok: false, reason }.
export async function checkDevice() {
  if (!navigator.gpu) return { ok: false, reason: "no-webgpu" };
  const adapter = await navigator.gpu.requestAdapter().catch(() => null);
  if (!adapter) return { ok: false, reason: "no-adapter" };
  const fast = adapter.features.has("shader-f16");
  const memory = navigator.deviceMemory || 8; // GB; only some browsers report it
  const mobile = /Android|iPhone|iPad|CrOS/i.test(navigator.userAgent);
  const suggested = mobile || memory <= 4 ? "light" : "standard";
  return { ok: true, fast, suggested };
}

function modelIdFor(size, fast) {
  const choice = MODEL_SIZES[size] || MODEL_SIZES.standard;
  return fast ? choice.fast : choice.compatible;
}

export async function isDownloaded(size, fast) {
  return hasModelInCache(modelIdFor(size, fast)).catch(() => false);
}

const ALL_MODEL_IDS = Object.values(MODEL_SIZES).flatMap((s) => [s.fast, s.compatible]);

// Deletes stored AI downloads from this device. A model that's already loaded
// keeps working until the tab closes, because it's in memory, not on disk.
//   keep: a size to leave in place (used when switching sizes)
export async function removeDownloads({ keep, fast } = {}) {
  const keepId = keep ? modelIdFor(keep, fast) : null;
  for (const id of ALL_MODEL_IDS) {
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
export async function loadEngine(size, fast, onProgress = () => {}) {
  const modelId = modelIdFor(size, fast);
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
