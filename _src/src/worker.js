import { pipeline, env } from '@huggingface/transformers';
import * as OpenCC from 'opencc-js';

env.allowLocalModels = false;
env.useBrowserCache = true;

// ONNX 執行檔放在本站，不靠外部 CDN
const base = new URL('./ort/', self.location.href).href;
const isSafari = /Safari\//.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|Edg/.test(navigator.userAgent);
const suffix = (isSafari && !('gpu' in navigator)) ? '' : '.asyncify';
env.backends.onnx.wasm.wasmPaths = {
  mjs: `${base}ort-wasm-simd-threaded${suffix}.mjs`,
  wasm: `${base}ort-wasm-simd-threaded${suffix}.wasm`,
};
env.backends.onnx.wasm.numThreads = 1;

const toTW = OpenCC.Converter({ from: 'cn', to: 'twp' });
const toCN = OpenCC.Converter({ from: 'tw', to: 'cn' });

const MODELS = {
  asr_base: { task: 'automatic-speech-recognition', id: 'Xenova/whisper-base.en', opts: { dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' } } },
  asr_tiny: { task: 'automatic-speech-recognition', id: 'Xenova/whisper-tiny.en', opts: { dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' } } },
  en2zh: { task: 'translation', id: 'Xenova/opus-mt-en-zh', opts: { dtype: 'q8' } },
  zh2en: { task: 'translation', id: 'Xenova/opus-mt-zh-en', opts: { dtype: 'q8' } },
};
const loaded = {};

async function load(key) {
  // 只保留一個語音辨識模型在記憶體
  if (key.startsWith('asr_')) {
    for (const k of Object.keys(loaded)) if (k.startsWith('asr_') && k !== key) {
      try { (await loaded[k]).dispose?.(); } catch {}
      delete loaded[k];
    }
  }
  if (!loaded[key]) {
    const m = MODELS[key];
    loaded[key] = pipeline(m.task, m.id, {
      ...m.opts,
      device: 'wasm',
      progress_callback: (p) => {
        if (p.status === 'progress' || p.status === 'done' || p.status === 'ready' || p.status === 'initiate') {
          self.postMessage({ type: 'progress', key, status: p.status, file: p.file, loaded: p.loaded, total: p.total, progress: p.progress });
        }
      },
    }).catch((e) => { delete loaded[key]; throw e; });
  }
  return loaded[key];
}

self.onmessage = async (ev) => {
  const { id, cmd } = ev.data;
  const reply = (data) => self.postMessage({ id, ...data });
  try {
    if (cmd === 'load') {
      await load(ev.data.key);
      reply({ ok: true });
    } else if (cmd === 'asr') {
      const asr = await load(ev.data.key);
      const t0 = performance.now();
      const out = await asr(ev.data.audio, { return_timestamps: false });
      let text = (out.text || '').trim();
      // Whisper 在雜訊中常產生的幻覺字
      if (/^(\[.*\]|\(.*\)|you\.?|thank you\.?|thanks for watching.*|\.+)$/i.test(text)) text = '';
      reply({ ok: true, text, ms: Math.round(performance.now() - t0) });
    } else if (cmd === 'en2zh') {
      const tr = await load('en2zh');
      const out = await tr(ev.data.text, { max_new_tokens: 256 });
      reply({ ok: true, text: toTW(out[0].translation_text) });
    } else if (cmd === 'zh2en') {
      const tr = await load('zh2en');
      const out = await tr(toCN(ev.data.text), { max_new_tokens: 256 });
      reply({ ok: true, text: out[0].translation_text });
    }
  } catch (e) {
    reply({ ok: false, error: String(e?.message || e) });
  }
};
