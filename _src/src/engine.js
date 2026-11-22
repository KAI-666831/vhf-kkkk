import { CATEGORIES, INCOMING_ONLY, GLOSSARY, PHONETIC } from './phrases.js';

const DIGIT_WORDS = {
  zero: '0', oh: '0', nadazero: '0', one: '1', wun: '1', unaone: '1', two: '2', too: '2', bissotwo: '2',
  three: '3', tree: '3', terrathree: '3', four: '4', fower: '4', kartefour: '4', five: '5', fife: '5', pantafive: '5',
  six: '6', soxisix: '6', seven: '7', setteseven: '7', eight: '8', ait: '8', oktoeight: '8',
  nine: '9', niner: '9', novenine: '9',
};
const SAFE_DIGIT = new Set(Object.keys(DIGIT_WORDS).filter(w => !['oh', 'too', 'one'].includes(w)));

// 把 "zero five zero" / "tree" / "niner" 這類念法轉成數字
export function normalizeNumbers(text) {
  const tokens = text.split(/(\s+|[,.;:!?])/);
  const out = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const words = run.filter(t => t.trim());
    const allowed = words.length >= 2 || SAFE_DIGIT.has(words[0].toLowerCase().replace(/-/g, ''));
    if (allowed) out.push(words.map(w => DIGIT_WORDS[w.toLowerCase().replace(/-/g, '')]).join(''));
    else out.push(...run);
    run = [];
  };
  for (const t of tokens) {
    const key = t.toLowerCase().replace(/-/g, '');
    if (DIGIT_WORDS[key]) { run.push(t); continue; }
    if (run.length && /^\s+$/.test(t)) { run.push(t); continue; }
    // 結尾空白不屬於數字串
    let trailing = [];
    while (run.length && /^\s+$/.test(run[run.length - 1])) trailing.unshift(run.pop());
    flush();
    out.push(...trailing, t);
  }
  let trailing = [];
  while (run.length && /^\s+$/.test(run[run.length - 1])) trailing.unshift(run.pop());
  flush();
  out.push(...trailing);
  return out.join('');
}

const norm = s => s.toLowerCase()
  .replace(/manoeuvre/g, 'maneuver').replace(/metres/g, 'meters')
  .replace(/pan[\s-]*pan/g, 'panpan')
  .replace(/[^a-z0-9#\s]/g, ' ').replace(/\b\d+(\.\d+)?\b/g, '#').replace(/\s+/g, ' ').trim();

const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'am', 'of', 'to', 'at', 'in', 'on', 'my', 'your', 'you', 'i', 'over', 'this', 'and', 'be', 'for', 'with', 'it', 'vhf']);

function bag(s) { return norm(s).split(' ').filter(w => w && !STOP.has(w) && w !== '#'); }

function bigrams(words) { const r = []; for (let i = 0; i < words.length - 1; i++) r.push(words[i] + ' ' + words[i + 1]); return r; }

// 建立比對用的句庫（去掉船名、參數）
const LIBRARY = [];
for (const cat of CATEGORIES) {
  for (const it of cat.items) {
    if (/^\{them\}, \{them\}/.test(it.en)) continue; // 呼叫句另外處理
    const core = it.en.replace(/\{them\}|\{me\}|\{cs\}|\{mmsi\}/g, ' ')
      .replace(/\{(\w+)\}/g, (m, k) => (k === 'side' || k === 'side2') ? 'side' : ' # ')
      .replace(/^(Question|Intention|Request|Advice|Warning|Information)\.\s*/i, '');
    LIBRARY.push({ zh: it.zh, en: it.en, words: bag(core), side: /\{side2?\}/.test(it.en) });
  }
}
for (const it of INCOMING_ONLY) LIBRARY.push({ zh: it.zh, en: it.en, words: bag(it.en) });

// 句子比對：詞袋 + 雙詞組重疊
const sideMap = w => (w === 'port' || w === 'starboard') ? 'side' : w;
function score(aWords, bWords, useSide) {
  if (!aWords.length || !bWords.length) return 0;
  if (useSide) aWords = aWords.map(sideMap);
  const A = new Set(aWords);
  const B = new Set(bWords);
  let inter = 0; for (const w of B) if (A.has(w)) inter++;
  const recall = inter / B.size;                 // 標準句的詞有多少出現
  const precision = inter / A.size;
  const ab = new Set(bigrams(aWords));
  const bb = bigrams(bWords); let bi = 0; for (const g of bb) if (ab.has(g)) bi++;
  const biScore = bb.length ? bi / bb.length : recall;
  return 0.55 * recall + 0.15 * precision + 0.30 * biScore;
}

export function matchPhrases(text) {
  // 依句號切開，每段各自比對
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
  const found = [];
  const seen = new Set();
  for (const s of sentences) {
    const w = bag(s);
    if (!w.length) continue;
    let best = null;
    for (const p of LIBRARY) {
      const sc = score(w, p.words, p.side);
      if (!best || sc > best.sc) best = { ...p, sc };
    }
    if (best && best.sc >= 0.62 && !seen.has(best.zh)) {
      seen.add(best.zh);
      let zh = best.zh;
      if (best.side) {
        const sides = [...s.toLowerCase().matchAll(/\b(port|starboard)\b/g)].map(m => m[1] === 'port' ? '左舷' : '右舷');
        if (sides.length) zh += `（${[...new Set(sides)].join('、')}）`;
      }
      found.push({ zh, sc: best.sc, src: s });
    }
  }
  return found;
}

// 術語偵測
const GLOSS_SORTED = [...GLOSSARY].sort((a, b) => b[0].length - a[0].length);
export function findTerms(text) {
  let t = ' ' + text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const found = [];
  for (const [en, zh] of GLOSS_SORTED) {
    const needle = ' ' + en + ' ';
    if (t.includes(needle)) {
      found.push([en, zh]);
      t = t.split(needle).join(' _ '); // 長詞優先，避免重複
    }
  }
  return found;
}

// 抽出數字資訊（航向、頻道、距離…）
export function findNumbers(text) {
  const r = [];
  const t = text.toLowerCase();
  const pats = [
    [/channel\s*(\d{1,2})\b/g, '頻道'],
    [/course\s*(?:is\s*)?(\d{3})\b/g, '航向（度）'],
    [/heading\s*(?:is\s*)?(\d{3})\b/g, '艏向（度）'],
    [/bearing\s*(\d{3})\b/g, '方位（度）'],
    [/(\d+(?:\.\d+)?)\s*(?:degrees)/g, '度'],
    [/(\d+(?:\.\d+)?)\s*(?:knots|knot)/g, '速度（節）'],
    [/(\d+(?:\.\d+)?)\s*(?:nautical miles|miles|nm)\b/g, '距離（海里）'],
    [/(\d+(?:\.\d+)?)\s*cables?\b/g, '距離（鏈）'],
    [/(\d+)\s*(?:metres|meters)\b/g, '距離（公尺）'],
    [/(\d{4})\s*utc\b/g, 'UTC 時間'],
    [/mmsi\s*(?:is\s*)?(\d{9})/g, 'MMSI'],
  ];
  const seen = new Set();
  for (const [re, label] of pats) {
    for (const m of t.matchAll(re)) {
      let v = m[1];
      if (label === 'UTC 時間') {
        const hh = (parseInt(v.slice(0, 2)) + 8) % 24;
        v = `${v.slice(0, 2)}:${v.slice(2)} UTC（台灣 ${String(hh).padStart(2, '0')}:${v.slice(2)}）`;
      }
      if (label === '度' && r.some(x => x[1] === v)) continue;
      const k = label + v;
      if (!seen.has(k)) { seen.add(k); r.push([label, v]); }
    }
  }
  return r;
}

// 把重複三次的船名收成一個
function collapseRepeat(s) {
  const w = s.replace(/[,]/g, ' ').trim().split(/\s+/).filter(Boolean);
  for (let k = 1; k <= Math.min(6, Math.floor(w.length / 2)); k++) {
    const unit = w.slice(0, k).join(' ').toLowerCase();
    let ok = true, n = 0;
    for (let i = 0; i < w.length; i += k) {
      const seg = w.slice(i, i + k).join(' ').toLowerCase();
      if (seg !== unit) { if (i + k <= w.length) ok = false; break; }
      n++;
    }
    if (ok && n >= 2) return w.slice(0, k).join(' ');
  }
  return w.join(' ');
}

export function parseCall(text) {
  const m = text.match(/^(.*?)\bthis is\b\s*(.*?)(?:[.]|\bover\b|$)/i);
  if (!m) return null;
  let callee = m[1].replace(/[.,]+$/, '').trim();
  let caller = m[2].replace(/[.,]+$/, '').trim();
  // 去掉前面的 mayday / securite 等
  callee = callee.replace(/^(mayday|pan[\s-]*pan|securit[ey])[\s,.]*/gi, '').trim();
  return {
    callee: callee ? collapseRepeat(callee) : '',
    caller: caller ? collapseRepeat(caller) : '',
  };
}

function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
export function nameSimilarity(a, b) {
  const x = a.toLowerCase().replace(/[^a-z0-9]/g, ''), y = b.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!x || !y) return 0;
  return 1 - lev(x, y) / Math.max(x.length, y.length);
}

// 檢查是否在呼叫本船
export function isCallingMe(text, myNames) {
  const names = myNames.filter(n => n && n.trim().length >= 2);
  if (!names.length) return false;
  const call = parseCall(text);
  const cands = [];
  if (call?.callee) cands.push(call.callee);
  // 沒有 "this is" 也比對開頭幾個字
  cands.push(text.split(/[.,]/)[0]);
  for (const c of cands) for (const n of names) {
    if (nameSimilarity(c, n) >= 0.7) return true;
    // 名字包含在一段話中
    const w = c.toLowerCase().split(/\s+/); const nw = n.toLowerCase().split(/\s+/).length;
    for (let i = 0; i + nw <= w.length; i++) if (nameSimilarity(w.slice(i, i + nw).join(' '), n) >= 0.75) return true;
  }
  return false;
}

export function detectPriority(text) {
  const t = text.toLowerCase();
  if (/\bmayday\b/.test(t)) return ['mayday', '遇險通報 MAYDAY'];
  if (/\bpan[\s-]*pan\b/.test(t)) return ['panpan', '緊急通報 PAN-PAN'];
  if (/\bsecurit[ey]\b|\bsay curitay\b/.test(t)) return ['securite', '安全警告 SÉCURITÉ'];
  return null;
}

// 給機器翻譯用：去掉程序用語、呼叫句，避免亂翻
export function cleanForMT(text) {
  let t = text;
  const call = t.match(/^(.*?)\bthis is\b\s*(.*?)(?:[.]|\bover\b)/i);
  if (call) t = t.slice(call[0].length).trim();
  t = t.replace(/\b(over and out|over|out)\s*[.!]?\s*$/i, '')
    .replace(/(^|[.!?]\s*)(question|instruction|advice|warning|information|intention|request|answer)\s*[.:,]\s*/gi, '$1')
    .replace(/\b(mayday|pan[\s-]*pan|securit[ey])[\s,.]*/gi, '')
    .replace(/\s+/g, ' ').trim();
  return t;
}

export function analyze(rawText, myNames = []) {
  const text = normalizeNumbers(rawText.trim());
  return {
    text,
    priority: detectPriority(text),
    call: parseCall(text),
    callingMe: isCallingMe(text, myNames),
    phrases: matchPhrases(text),
    terms: findTerms(text),
    numbers: findNumbers(text),
    mtInput: cleanForMT(text),
  };
}

// ---------- 發話用 ----------
const ITU = ['zero', 'one', 'two', 'tree', 'fower', 'fife', 'six', 'seven', 'eight', 'niner'];
const STD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

// 數字一位一位念，小數點念 decimal
export function spokenNumbers(text, itu = false) {
  const W = itu ? ITU : STD;
  return text.replace(/\d+(?:\.\d+)?/g, m => m.split('').map(c => c === '.' ? 'decimal' : W[+c]).join(' '));
}

export function spellPhonetic(name) {
  return name.toUpperCase().split('').map(c => PHONETIC[c] || (/\d/.test(c) ? STD[+c] : null)).filter(Boolean).join(', ');
}

export function fillTemplate(tpl, vals) {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (vals[k] ?? '').toString().trim() || '___');
}

// 船名中的 No. 念成 number
export function speakableName(s) {
  return s.replace(/\bNO\.?\s*(?=\d)/gi, 'Number ');
}
