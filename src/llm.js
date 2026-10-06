// Talks to any server that speaks the OpenAI-compatible chat API: Ollama
// (the default, free and running on your own computer), LM Studio,
// llama.cpp's server, or a cloud provider if you ever want one.

export class LLMError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // "unreachable" | "model_missing" | "http"
  }
}

// Some models (DeepSeek-R1, Qwen3) write their reasoning inside <think> tags.
// This hides it from students, even when a tag is split across chunks.
export function createThinkFilter() {
  let pending = "";
  let thinking = false;
  return function push(chunk) {
    pending += chunk;
    let visible = "";
    for (;;) {
      const tag = thinking ? "</think>" : "<think>";
      const at = pending.indexOf(tag);
      if (at !== -1) {
        if (!thinking) visible += pending.slice(0, at);
        pending = pending.slice(at + tag.length);
        thinking = !thinking;
        continue;
      }
      // Hold back anything that might be the start of a tag.
      const lt = pending.lastIndexOf("<");
      const keep = lt !== -1 && tag.startsWith(pending.slice(lt)) ? pending.length - lt : 0;
      if (!thinking) visible += pending.slice(0, pending.length - keep);
      pending = pending.slice(pending.length - keep);
      return visible;
    }
  };
}

export function createLLM({ baseUrl, model, apiKey }) {
  const root = baseUrl.replace(/\/+$/, "");
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  async function post(body, signal) {
    let res;
    try {
      res = await fetch(`${root}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, ...body }),
        signal,
      });
    } catch (err) {
      if (err.name === "AbortError") throw err;
      throw new LLMError("unreachable", `Couldn't connect to the AI at ${root}. Is Ollama running?`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 404 && /model/i.test(text)) {
        throw new LLMError("model_missing", `The model "${model}" isn't downloaded. Run: ollama pull ${model}`);
      }
      throw new LLMError("http", `The AI server returned ${res.status}: ${text.slice(0, 200)}`);
    }
    return res;
  }

  return {
    model,

    // Streams a reply, calling onText with each visible piece. Returns the full text.
    async chat({ messages, signal, onText = () => {} }) {
      const res = await post({ messages, stream: true, temperature: 0.6 }, signal);
      const hideThinking = createThinkFilter();
      const decoder = new TextDecoder();
      let buffered = "";
      let full = "";
      for await (const chunk of res.body) {
        buffered += decoder.decode(chunk, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop();
        for (const line of lines) {
          const data = line.replace(/^data:\s*/, "").trim();
          if (!data || data === "[DONE]" || !line.startsWith("data:")) continue;
          let event;
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }
          const piece = hideThinking(event.choices?.[0]?.delta?.content || "");
          if (piece) {
            full += piece;
            onText(piece);
          }
        }
      }
      return full;
    },

    // Asks for JSON matching `schema`. Returns the parsed object, or null if
    // the model produced something unusable (small models sometimes do).
    async json({ messages, schema, signal }) {
      const res = await post(
        {
          messages,
          stream: false,
          temperature: 0,
          response_format: { type: "json_schema", json_schema: { name: "result", schema } },
        },
        signal,
      );
      const body = await res.json();
      const text = createThinkFilter()(body.choices?.[0]?.message?.content || "");
      try {
        return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      } catch {
        return null;
      }
    },

    // Checks the AI server is up and has the model. Used at startup.
    async checkReady() {
      try {
        const res = await fetch(`${root}/models`, { headers });
        if (!res.ok) return { ok: true }; // some servers don't list models; assume fine
        const { data = [] } = await res.json();
        const names = data.map((m) => m.id);
        const found = names.some((n) => n === model || n === `${model}:latest`);
        return found || names.length === 0 ? { ok: true } : { ok: false, reason: "model_missing" };
      } catch {
        return { ok: false, reason: "unreachable" };
      }
    },
  };
}
