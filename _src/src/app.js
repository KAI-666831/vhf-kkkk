import { CATEGORIES, PARAM_DEFS, GLOSSARY, PHONETIC } from './phrases.js';
import { analyze, spokenNumbers, spellPhonetic, fillTemplate, speakableName } from './engine.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- 設定 ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('vhf.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('vhf.' + k, JSON.stringify(v)); } catch {} },
};
const S = {
  myName: store.get('myName', ''), myAlias: store.get('myAlias', ''), myCS: store.get('myCS', ''), myMMSI: store.get('myMMSI', ''),
  themName: store.get('themName', ''), voice: store.get('voice', ''), rate: store.get('rate', 0.85), itu: store.get('itu', false),
  asr: store.get('asr', 'asr_base'), sens: store.get('sens', 6), lmode: store.get('lmode', 'auto'), params: store.get('params', {}),
};
const save = (k, v) => { S[k] = v; store.set(k, v); };

for (const k of ['myName', 'myAlias', 'myCS', 'myMMSI', 'themName']) {
  const el = $('#' + k); el.value = S[k];
  el.addEventListener('input', () => save(k, el.value.trim()));
}
$('#rate').value = S.rate; $('#rateV').textContent = S.rate;
$('#rate').addEventListener('input', e => { save('rate', +e.target.value); $('#rateV').textContent = e.target.value; });
$('#itu').checked = S.itu; $('#itu').addEventListener('change', e => save('itu', e.target.checked));
$('#sens').value = S.sens; $('#sens').addEventListener('input', e => save('sens', +e.target.value));
$$('input[name=asrSel]').forEach(r => { r.checked = r.value === S.asr; r.addEventListener('change', () => { save('asr', r.value); refreshModels(); }); });
$$('input[name=lmode]').forEach(r => { r.checked = r.value === S.lmode; r.addEventListener('change', () => save('lmode', r.value)); });

// ---------- 分頁 ----------
$$('nav button').forEach(b => b.addEventListener('click', () => {
  $$('nav button').forEach(x => x.classList.toggle('active', x === b));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'settings') refreshModels();
}));

const updNet = () => { $('#netBadge').textContent = navigator.onLine ? '連線中' : '離線'; };
addEventListener('online', updNet); addEventListener('offline', updNet); updNet();

// ---------- Worker ----------
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let rid = 0; const pend = new Map();
const dl = {}; // 下載進度 file -> {loaded,total}
worker.onmessage = (e) => {
  const d = e.data;
  if (d.type === 'progress') { onProgress(d); return; }
  const p = pend.get(d.id); if (!p) return; pend.delete(d.id);
  d.ok ? p.res(d) : p.rej(new Error(d.error));
};
worker.onerror = (e) => console.error('worker error', e);
const call = (cmd, data = {}) => new Promise((res, rej) => { const id = ++rid; pend.set(id, { res, rej }); worker.postMessage({ id, cmd, ...data }); });

function onProgress(d) {
  if (d.file && d.total) dl[d.key + d.file] = { loaded: d.loaded || 0, total: d.total };
  if (d.status === 'done' && d.file && dl[d.key + d.file]) dl[d.key + d.file].loaded = dl[d.key + d.file].total;
  const items = Object.entries(dl).filter(([k]) => k.startsWith(d.key));
  const L = items.reduce((a, [, v]) => a + v.loaded, 0), T = items.reduce((a, [, v]) => a + v.total, 0);
  if (T > 0) {
    $('#dlBar').style.width = (100 * L / T).toFixed(1) + '%';
    $('#dlText').textContent = `${keyName(d.key)}：${(L / 1048576).toFixed(0)} / ${(T / 1048576).toFixed(0)} MB`;
  }
  if (d.status === 'ready') { $('#dlText').textContent = keyName(d.key) + '：已就緒'; }
}
const keyName = k => ({ asr_base: '語音辨識（標準）', asr_tiny: '語音辨識（快速）', en2zh: '英翻中', zh2en: '中翻英' }[k] || k);
const MODEL_IDS = { asr_base: 'whisper-base.en', asr_tiny: 'whisper-tiny.en', en2zh: 'opus-mt-en-zh', zh2en: 'opus-mt-zh-en' };

async function cachedModels() {
  const have = new Set();
  try {
    const c = await caches.open('transformers-cache');
    const keys = await c.keys();
    for (const [k, id] of Object.entries(MODEL_IDS)) if (keys.some(r => r.url.includes(id) && r.url.includes('.onnx'))) have.add(k);
  } catch {}
  return have;
}
const ready = new Set();
async function refreshModels() {
  const have = await cachedModels();
  for (const row of $$('.model')) {
    const key = row.dataset.key === 'asr' ? S.asr : row.dataset.key;
    const st = row.querySelector('.st');
    const ok = have.has(key);
    st.textContent = ready.has(key) ? '已載入' : ok ? '已下載' : '未下載';
    st.classList.toggle('ok', ok || ready.has(key));
    row.querySelector('button').textContent = ok ? '重新載入' : '下載';
  }
  try {
    const est = await navigator.storage.estimate();
    $('#storage').textContent = `已用空間約 ${(est.usage / 1048576).toFixed(0)} MB`;
  } catch {}
  const asrOk = have.has(S.asr);
  $('#modelWarn').classList.toggle('hidden', asrOk);
  $('#modelWarn').innerHTML = '第一次使用請到「設定」下載語音辨識和英翻中模型（需要 Wi-Fi，下載一次之後就能離線用）。';
  return have;
}
$$('.model button').forEach(b => b.addEventListener('click', async () => {
  const row = b.closest('.model');
  const key = row.dataset.key === 'asr' ? S.asr : row.dataset.key;
  b.disabled = true; row.querySelector('.st').textContent = '下載中…';
  try { navigator.storage?.persist?.(); } catch {}
  try { await loadModel(key); b.disabled = false; refreshModels(); }
  catch (e) { b.disabled = false; row.querySelector('.st').textContent = '下載失敗，請確認網路後再試'; console.error(e); }
}));
const loading = {};
function loadModel(key) {
  if (ready.has(key)) return Promise.resolve();
  if (!loading[key]) loading[key] = call('load', { key }).then(() => { ready.add(key); }).finally(() => { delete loading[key]; });
  return loading[key];
}

// ---------- 語音 TTS ----------
let voices = [];
function loadVoices() {
  voices = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang));
  const sel = $('#voiceSel');
  sel.innerHTML = voices.map(v => `<option value="${esc(v.voiceURI)}">${esc(v.name)} (${v.lang})${v.localService ? '' : ' ☁︎'}</option>`).join('') || '<option>系統預設英文語音</option>';
  if (S.voice) sel.value = S.voice;
  if (!S.voice || sel.value !== S.voice) {
    const pref = voices.find(v => v.localService && v.lang === 'en-GB') || voices.find(v => v.localService && v.lang === 'en-US') || voices[0];
    if (pref) sel.value = pref.voiceURI;
  }
}
speechSynthesis.onvoiceschanged = loadVoices; loadVoices();
$('#voiceSel').addEventListener('change', e => save('voice', e.target.value));

function setSession(type) { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch {} }

function speak(text, { slow = false } = {}) {
  if (listening) stopListen();
  setSession('playback');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(spokenNumbers(speakableName(text), S.itu));
  const v = voices.find(v => v.voiceURI === $('#voiceSel').value);
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
  u.rate = slow ? Math.max(0.5, S.rate - 0.2) : S.rate;
  speechSynthesis.speak(u);
}
$('#btnStop').addEventListener('click', () => speechSynthesis.cancel());
$('#btnTestVoice').addEventListener('click', () => speak('This is a radio check on channel 16. Over.'));

// ---------- 說：船名 ----------
$('#btnSayName').addEventListener('click', () => { const n = $('#themName').value.trim(); if (n) speak(`${n}. ${n}. ${n}.`); });
$('#btnSpellName').addEventListener('click', () => { const n = $('#themName').value.trim(); if (n) speak('I spell. ' + spellPhonetic(n.replace(/\s+/g, ''))); });

// ---------- 說：標準句 ----------
let curCat = CATEGORIES[0].id;
function renderCats() {
  $('#catTabs').innerHTML = CATEGORIES.map(c => `<button class="chip ${c.id === curCat ? 'active' : ''}" data-c="${c.id}">${c.name}</button>`).join('');
  $$('#catTabs .chip').forEach(b => b.addEventListener('click', () => { curCat = b.dataset.c; renderCats(); }));
  const cat = CATEGORIES.find(c => c.id === curCat);
  $('#catWarn').classList.toggle('hidden', !cat.warn); $('#catWarn').textContent = cat.warn || '';
  $('#phraseList').innerHTML = cat.items.map((it, i) => `<button class="ph" data-i="${i}"><div class="z">${esc(it.zh)}</div><div class="e">${esc(it.en.replace(/\{them\}/g, '〔對方〕').replace(/\{me\}/g, '〔本船〕').replace(/\{(\w+)\}/g, (m, k) => '〔' + (PARAM_DEFS[k]?.label.replace(/（.*）/, '') || k) + '〕'))}</div></button>`).join('');
  $$('#phraseList .ph').forEach(b => b.addEventListener('click', () => openSheet(cat.items[+b.dataset.i])));
}
renderCats();

let sheetItem = null;
function sheetVals() {
  const v = { them: S.themName || $('#themName').value.trim(), me: S.myName, cs: spellPhonetic(S.myCS || ''), mmsi: S.myMMSI };
  for (const inp of $$('#shParams [data-p]')) v[inp.dataset.p] = inp.value;
  return v;
}
function sheetText() { return fillTemplate(sheetItem.en, sheetVals()); }
function openSheet(it) {
  sheetItem = it;
  $('#shZh').textContent = it.zh;
  const need = [];
  if (/\{them\}/.test(it.en) && !$('#themName').value.trim()) need.push('上方先填「對方船名」');
  if (/\{me\}/.test(it.en) && !S.myName) need.push('到「設定」填本船船名');
  if (/\{mmsi\}|\{cs\}/.test(it.en) && (!S.myCS || !S.myMMSI)) need.push('到「設定」填呼號與 MMSI');
  let html = need.length ? `<div class="notice warn">${need.join('；')}</div>` : '';
  for (const k of it.p || []) {
    const d = PARAM_DEFS[k]; const val = S.params[k] ?? d.def;
    html += `<div class="pl">${d.label}</div>`;
    if (d.type === 'sel') html += `<select data-p="${k}">${d.opts.map(([v, z]) => `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select>`;
    else html += `<input data-p="${k}" value="${esc(val)}" ${d.type === 'num' ? 'inputmode="decimal"' : ''}>`;
  }
  $('#shParams').innerHTML = html;
  const upd = () => {
    for (const inp of $$('#shParams [data-p]')) S.params[inp.dataset.p] = inp.value;
    store.set('params', S.params);
    $('#shEn').textContent = sheetText();
  };
  $$('#shParams [data-p]').forEach(i => i.addEventListener('input', upd));
  upd();
  $('#sheet').classList.remove('hidden');
}
$('#shPlay').addEventListener('click', () => speak(sheetText()));
$('#shSlow').addEventListener('click', () => speak(sheetText(), { slow: true }));
$('#shClose').addEventListener('click', () => { $('#sheet').classList.add('hidden'); speechSynthesis.cancel(); });
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') $('#shClose').click(); });

// ---------- 說：自由中翻英 ----------
$('#btnZh2En').addEventListener('click', async () => {
  const t = $('#zhIn').value.trim(); if (!t) return;
  const b = $('#btnZh2En'); b.disabled = true; b.textContent = ready.has('zh2en') ? '翻譯中…' : '載入模型中…';
  try { await loadModel('zh2en'); b.textContent = '翻譯中…'; const r = await call('zh2en', { text: t }); $('#enOut').value = r.text; }
  catch (e) { $('#enOut').value = ''; alertBox('中翻英失敗：' + e.message + '（需先在設定下載中翻英模型）'); }
  b.disabled = false; b.textContent = '翻成英文';
});
$('#btnSpeakEn').addEventListener('click', () => { const t = $('#enOut').value.trim(); if (t) speak(t); });

function alertBox(msg) { const n = $('#modelWarn'); n.textContent = msg; n.classList.remove('hidden'); }

// ---------- 詞彙 ----------
function renderVocab() {
  const q = $('#vSearch').value.trim().toLowerCase();
  const f = ([e, z]) => !q || e.toLowerCase().includes(q) || z.includes(q);
  const g = GLOSSARY.filter(f);
  const ph = Object.entries(PHONETIC).map(([k, v]) => [v, k]).filter(f);
  const nums = [['zero', '0'], ['one', '1'], ['two', '2'], ['tree', '3'], ['fower', '4'], ['fife', '5'], ['six', '6'], ['seven', '7'], ['eight', '8'], ['niner', '9']].filter(f);
  const sec = (title, arr) => arr.length ? `<div class="vh">${title}</div>` + arr.map(([e, z]) => `<div class="vi" data-say="${esc(e)}"><span class="e">${esc(e)}</span><span class="z">${esc(z)}</span></div>`).join('') : '';
  $('#vocabList').innerHTML = sec('航海術語', g) + sec('字母拼讀', ph) + sec('數字念法（ITU）', nums);
  $$('#vocabList .vi').forEach(d => d.addEventListener('click', () => { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(d.dataset.say); u.lang = 'en-US'; const v = voices.find(v => v.voiceURI === $('#voiceSel').value); if (v) u.voice = v; u.rate = S.rate; speechSynthesis.speak(u); }));
}
$('#vSearch').addEventListener('input', renderVocab); renderVocab();

// ---------- 聽：錄音與分段 ----------
let listening = false, actx, stream, proc, srcNode, wakeLock;
let seg = null, pre = [], below = 0, above = 0, noise = 0.003, segSamples = 0;
const queue = []; let busy = false;

function threshold() { const f = 11 - S.sens; return Math.max(noise * (1.4 + f * 0.45), 0.004 + f * 0.0012); }

async function startListen() {
  try {
    setSession('play-and-record');
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 } });
  } catch (e) { alertBox('無法使用麥克風：' + e.message); return; }
  actx = new (window.AudioContext || window.webkitAudioContext)();
  await actx.resume();
  srcNode = actx.createMediaStreamSource(stream);
  proc = actx.createScriptProcessor(4096, 1, 1);
  const mute = actx.createGain(); mute.gain.value = 0;
  srcNode.connect(proc); proc.connect(mute); mute.connect(actx.destination);
  proc.onaudioprocess = onAudio;
  listening = true; seg = null; pre = []; below = 0; above = 0;
  const manual = S.lmode === 'manual';
  if (manual) seg = [];
  $('#btnListen').textContent = manual ? '■ 結束這段並翻譯' : '■ 停止收聽';
  $('#btnListen').classList.add('rec');
  $('#lstate').textContent = manual ? '錄音中…' : '等待聲音…';
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  ensureModelsForListen();
}
function stopListen() {
  if (!listening) return;
  listening = false;
  if (seg && seg.length) finishSeg();
  try { proc.disconnect(); srcNode.disconnect(); } catch {}
  stream?.getTracks().forEach(t => t.stop());
  actx?.close();
  setSession('playback');
  try { wakeLock?.release(); } catch {}
  $('#btnListen').textContent = '開始收聽'; $('#btnListen').classList.remove('rec');
  $('#lstate').textContent = '待機'; $('#meter').style.width = '0';
}
$('#btnListen').addEventListener('click', () => listening ? stopListen() : startListen());

function onAudio(e) {
  const x = e.inputBuffer.getChannelData(0);
  const buf = new Float32Array(x);
  let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  const rms = Math.sqrt(s / buf.length);
  const thr = threshold();
  const scale = v => Math.min(100, Math.sqrt(v / 0.2) * 100);
  $('#meter').style.width = scale(rms) + '%';
  $('#thrMark').style.left = scale(thr) + '%';
  const chunkMs = 1000 * buf.length / actx.sampleRate;

  if (S.lmode === 'manual') {
    seg.push(buf); segSamples += buf.length;
    if (segSamples / actx.sampleRate > 28) { finishSeg(); seg = []; }
    return;
  }
  if (!seg) {
    // 背景雜訊慢慢追
    noise = rms < noise ? noise * 0.9 + rms * 0.1 : noise * 0.995 + rms * 0.005;
    pre.push(buf); if (pre.length > 4) pre.shift();
    if (rms > thr) { if (++above >= 2) { seg = [...pre]; segSamples = seg.reduce((a, b) => a + b.length, 0); below = 0; $('#lstate').textContent = '收音中…'; } }
    else above = 0;
  } else {
    seg.push(buf); segSamples += buf.length;
    if (rms < thr) below += chunkMs; else below = 0;
    const dur = segSamples / actx.sampleRate;
    if (below > 900 || dur > 28) { finishSeg(); }
  }
}

function finishSeg() {
  const chunks = seg; seg = null; above = 0; below = 0;
  const sr = actx.sampleRate; segSamples = 0;
  if (listening && S.lmode === 'manual') { stopListen(); }
  const total = chunks.reduce((a, b) => a + b.length, 0);
  if (total / sr < 0.6) { if (listening) $('#lstate').textContent = '等待聲音…'; return; }
  const all = new Float32Array(total); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  const audio = resample(all, sr, 16000);
  if (listening) $('#lstate').textContent = '等待聲音…';
  enqueue(audio);
}

function resample(x, from, to) {
  if (from === to) return x;
  const n = Math.round(x.length * to / from); const y = new Float32Array(n); const r = from / to;
  for (let i = 0; i < n; i++) {
    const p = i * r, j = Math.floor(p), f = p - j;
    y[i] = (x[j] || 0) * (1 - f) + (x[j + 1] || 0) * f;
  }
  // 音量正規化
  let m = 0; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(y[i]));
  if (m > 0 && m < 0.5) { const g = 0.5 / m; for (let i = 0; i < n; i++) y[i] *= g; }
  return y;
}

async function ensureModelsForListen() {
  const have = await cachedModels();
  if (!have.has(S.asr) && !navigator.onLine) { alertBox('語音辨識模型還沒下載，請先連上網路到「設定」下載。'); return; }
  loadModel(S.asr).catch(e => alertBox('語音辨識模型載入失敗：' + e.message));
  if (have.has('en2zh') || navigator.onLine) loadModel('en2zh').catch(() => {});
}

function enqueue(audio) {
  const card = newCard(audio);
  queue.push({ audio, card }); pump();
}
async function pump() {
  if (busy || !queue.length) return;
  busy = true;
  const { audio, card } = queue.shift();
  try {
    card.querySelector('.en').textContent = ready.has(S.asr) ? '辨識中…' : '載入辨識模型中…';
    await loadModel(S.asr);
    card.querySelector('.en').textContent = '辨識中…';
    const r = await call('asr', { key: S.asr, audio });
    if (!r.text) { card.remove(); }
    else await fillCard(card, r.text, r.ms);
  } catch (e) {
    card.querySelector('.en').textContent = '辨識失敗：' + e.message;
  }
  busy = false; pump();
}

function newCard(audio) {
  const d = document.createElement('div');
  d.className = 'res';
  const t = new Date();
  d.innerHTML = `<div class="meta"><span>${t.toLocaleTimeString('zh-TW', { hour12: false })}</span><span class="ms"></span></div><div class="ban"></div><div class="call"></div><div class="en muted">…</div><div class="out"></div>`;
  if (audio) {
    const btns = document.createElement('div'); btns.className = 'rbtns';
    btns.innerHTML = '<button class="replay">▶ 重聽原音</button>';
    btns.querySelector('.replay').addEventListener('click', () => playRaw(audio.slice ? audio.slice() : audio));
    d.appendChild(btns);
    d._audio = audio.slice();
  }
  $('#results').prepend(d);
  const all = $$('#results .res'); if (all.length > 60) all.at(-1).remove();
  return d;
}
function playRaw(a) {
  if (listening) stopListen();
  setSession('playback');
  const c = new (window.AudioContext || window.webkitAudioContext)();
  const b = c.createBuffer(1, a.length, 16000); b.copyToChannel(a, 0);
  const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(); s.onended = () => c.close();
}

async function fillCard(card, rawText, ms) {
  const A = analyze(rawText, [S.myName, S.myAlias]);
  if (ms) card.querySelector('.ms').textContent = (ms / 1000).toFixed(1) + ' 秒';
  let ban = '';
  if (A.priority) ban += `<div class="banner ${A.priority[0]}">${A.priority[1]}</div>`;
  if (A.callingMe) { ban += `<div class="banner me">🔔 可能在呼叫本船</div>`; card.classList.add('me'); }
  card.querySelector('.ban').innerHTML = ban;
  if (A.call && (A.call.callee || A.call.caller)) {
    card.querySelector('.call').innerHTML = `呼叫對象：<b>${esc(A.call.callee || '？')}</b>　發話方：<b>${esc(A.call.caller || '？')}</b>`;
  }
  const en = card.querySelector('.en'); en.classList.remove('muted'); en.textContent = A.text;
  let html = '';
  for (const p of A.phrases) html += `<div class="std">✓ ${esc(p.zh)}</div>`;
  html += `<div class="mt pending">翻譯中…</div>`;
  if (A.numbers.length) html += `<div class="chips">${A.numbers.map(([l, v]) => `<span class="chip">${esc(l)} <b>${esc(v)}</b></span>`).join('')}</div>`;
  if (A.terms.length) html += `<div class="chips">${A.terms.map(([e, z]) => `<span class="chip">${esc(e)} = <b>${esc(z)}</b></span>`).join('')}</div>`;
  card.querySelector('.out').innerHTML = html;
  const mt = card.querySelector('.mt');
  if (!A.mtInput || A.mtInput.split(/\s+/).length < 2) { mt.remove(); return; }
  try {
    await loadModel('en2zh');
    const r = await call('en2zh', { text: A.mtInput });
    mt.classList.remove('pending'); mt.innerHTML = `<span class="tag">機器翻譯</span>${esc(r.text)}`;
  } catch (e) { mt.textContent = '（英翻中模型未下載）'; }
}

$('#btnTypeEn').addEventListener('click', () => {
  const t = $('#typeEn').value.trim(); if (!t) return;
  const card = newCard(null); fillCard(card, t);
});

refreshModels();

// ---------- 離線 ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
