// Read-aloud (speech synthesis) and voice typing (speech recognition), using
// what the browser has built in.

export const canSpeak = typeof speechSynthesis !== "undefined";
const Recognition = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : undefined;
export const canListen = Boolean(Recognition);

// The language to pronounce vocabulary in, for language subjects.
export function speechLangFor(subject = "") {
  if (/french|français|francais/i.test(subject)) return "fr-FR";
  if (/spanish|español|espanol/i.test(subject)) return "es-ES";
  return null;
}

// Whether a bold or italic phrase in a reply is in the language being studied,
// so English words aren't read out in a French or Spanish accent.
const FOREIGN = {
  fr: /[àâçéèêëîïôûùüÿœæ]|\b(je|j'|tu|il|elle|nous|vous|ils|elles|le|la|les|l'|un|une|des|du|est|suis|es|sont|ai|avons|avez|ont|et|mais|avec|pour|dans|c'est|qu'|ne|pas|mon|mes|tes|ses|aux)\b/i,
  es: /[áéíóúñü¿¡]|\b(yo|tú|él|ella|nosotros|vosotros|ellos|ellas|el|la|los|las|un|una|unos|unas|es|son|soy|eres|está|estoy|están|y|pero|con|para|en|de|del|que|mi|mis|tu|tus|su|sus|muy)\b/i,
};
export function looksForeign(text, lang) {
  const test = FOREIGN[(lang || "").slice(0, 2)];
  return Boolean(test && test.test(text));
}

// Turns a Markdown reply into something pleasant to listen to.
export function textForSpeech(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ") // code blocks and question blocks
    .replace(/^\s*\|?[-:| ]+\|?\s*$/gm, " ") // table dividers
    .replace(/\|/g, ", ")
    .replace(/[*_`#>~]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function voiceFor(lang) {
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.lang === lang) || voices.find((v) => v.lang.startsWith(lang.slice(0, 2)));
}

// Speaks text; calls onEnd when finished or stopped.
export function speak(text, { lang = "en-US", rate = 1, onEnd = () => {} } = {}) {
  if (!canSpeak) return onEnd();
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = rate;
  const voice = voiceFor(lang);
  if (voice) utterance.voice = voice;
  utterance.onend = utterance.onerror = () => onEnd();
  speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (canSpeak) speechSynthesis.cancel();
}

// Starts voice typing. Returns a function that stops it.
//   onText(text, final): the words heard so far
export function listen({ lang = navigator.language || "en-US", onText, onEnd = () => {}, onError = () => {} }) {
  const recognition = new Recognition();
  recognition.lang = lang;
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.onresult = (event) => {
    const text = [...event.results].map((r) => r[0].transcript).join("");
    onText(text, event.results[event.results.length - 1].isFinal);
  };
  recognition.onerror = (event) => onError(event.error);
  recognition.onend = () => onEnd();
  recognition.start();
  return () => recognition.stop();
}
