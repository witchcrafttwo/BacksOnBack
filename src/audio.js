// 効果音。素材を持たずに WebAudio で合成する。
// 最初のユーザー操作で初期化する(自動再生ポリシー対策)。

let ctx = null;
let master = null;
let muted = false;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.32;
  master.connect(ctx.destination);
  return ctx;
}

export function unlockAudio() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.32;
  return muted;
}

export const isMuted = () => muted;

function tone({ freq = 440, to = freq, type = 'sine', dur = 0.14, gain = 0.5, delay = 0 }) {
  const c = ensure();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.12, gain = 0.4, freq = 1200, q = 0.7, delay = 0 }) {
  const c = ensure();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(g).connect(master);
  src.start(t0);
}

/** 着地音。強さ 0..1 */
export function sfxThud(power = 0.5) {
  const p = Math.min(1, Math.max(0.08, power));
  tone({ freq: 150 - 50 * p, to: 58, type: 'triangle', dur: 0.1 + 0.1 * p, gain: 0.2 + 0.45 * p });
  noise({ dur: 0.07 + 0.06 * p, gain: 0.1 + 0.22 * p, freq: 420, q: 0.5 });
}

/** 中身ドバー */
export function sfxBurst() {
  noise({ dur: 0.3, gain: 0.5, freq: 900, q: 0.35 });
  tone({ freq: 780, to: 120, type: 'sawtooth', dur: 0.26, gain: 0.3 });
  tone({ freq: 240, to: 90, type: 'square', dur: 0.18, gain: 0.18, delay: 0.04 });
}

/** パーフェクト */
export function sfxPerfect(step = 0) {
  const base = 880 * Math.pow(1.0595, Math.min(step, 12));
  tone({ freq: base, type: 'sine', dur: 0.1, gain: 0.32 });
  tone({ freq: base * 1.5, type: 'sine', dur: 0.16, gain: 0.26, delay: 0.07 });
}

export function sfxPlace() {
  tone({ freq: 520, to: 660, type: 'sine', dur: 0.09, gain: 0.2 });
}

/** 落下・ミス */
export function sfxFail() {
  tone({ freq: 320, to: 70, type: 'sawtooth', dur: 0.45, gain: 0.34 });
  noise({ dur: 0.34, gain: 0.22, freq: 300, q: 0.4 });
}

export function sfxGameOver() {
  [523, 440, 349, 262].forEach((f, i) =>
    tone({ freq: f, type: 'triangle', dur: 0.3, gain: 0.3, delay: i * 0.17 }),
  );
}

export function sfxWhoosh() {
  noise({ dur: 0.5, gain: 0.1, freq: 700, q: 0.25 });
}

export function sfxClick() {
  tone({ freq: 660, type: 'square', dur: 0.05, gain: 0.14 });
}

/** ジッパーがきしむ音。level 0 -> 1 で危険度アップ */
export function sfxCreak(level = 0) {
  const f = level ? 1500 : 900;
  noise({ dur: 0.18, gain: level ? 0.2 : 0.12, freq: f, q: 5 });
  tone({ freq: f * 0.5, to: f * 0.42, type: 'sawtooth', dur: 0.14, gain: 0.07 });
}

/** ファスナーをシャーッと閉める音 */
export function sfxZip() {
  noise({ dur: 0.38, gain: 0.22, freq: 2600, q: 1.6 });
  tone({ freq: 260, to: 980, type: 'sawtooth', dur: 0.34, gain: 0.06 });
}

/** できないときのブッ */
export function sfxBuzz() {
  tone({ freq: 150, type: 'square', dur: 0.15, gain: 0.14 });
  tone({ freq: 120, type: 'square', dur: 0.12, gain: 0.1, delay: 0.09 });
}
