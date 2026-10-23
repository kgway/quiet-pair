// No CSV or text is sent via fetch: model inference runs inside this worker.
// Pinned standalone browser bundle (web.js needs bare-module resolution).
import { MODEL, MODEL_REVISION } from './config.mjs';
let extractor, runtime;
self.onmessage = async ({ data }) => {
  try {
    const start = performance.now();
    if (!runtime) {
      self.postMessage({ type: 'progress', message: 'Loading the browser AI runtime…' });
      runtime = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
      runtime.env.allowLocalModels = false;
      runtime.env.backends.onnx.wasm.numThreads = 1;
    }
    const { pipeline } = runtime;
    if (!extractor) extractor = await pipeline('feature-extraction', MODEL, {
      device: 'wasm', dtype: 'q8', revision: MODEL_REVISION,
      progress_callback: p => self.postMessage({ type: 'progress', message: p.status === 'progress' ? `Loading ${p.file}: ${Math.round(p.progress || 0)}%` : `Model: ${p.status}` }),
    });
    const loaded = performance.now(); const vectors = [];
    for (let i = 0; i < data.texts.length; i += 8) {
      const out = await extractor(data.texts.slice(i, i + 8), { pooling: 'mean', normalize: true });
      vectors.push(...out.tolist());
      self.postMessage({ type: 'progress', message: `Reading rows ${Math.min(i + 8, data.texts.length)} / ${data.texts.length}` });
    }
    self.postMessage({ type: 'complete', vectors, loadMs: loaded - start, inferenceMs: performance.now() - loaded });
  } catch (error) { self.postMessage({ type: 'error', message: error.message || String(error) }); }
};
