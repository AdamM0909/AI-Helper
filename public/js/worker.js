// Runs the AI model in a background thread so the page stays responsive.
import { WebWorkerMLCEngineHandler } from "../vendor/web-llm.js";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (message) => handler.onmessage(message);
