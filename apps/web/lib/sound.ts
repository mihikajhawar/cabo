/** Tiny synthesised sound effects (Web Audio): no audio files to download, volume kept low. */
let ctx: AudioContext | null = null;
let muted = false;
try { muted = localStorage.getItem('cabo.mute') === '1'; } catch {}

function ac(): AudioContext | null {
  if (typeof window === 'undefined' || muted) return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    try { ctx = new C(); } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
function noise(c: AudioContext, at: number, dur: number, type: BiquadFilterType, freq: number, q: number, vol: number) {
  const n = Math.max(1, Math.floor(c.sampleRate * dur)); const buf = c.createBuffer(1, n, c.sampleRate); const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = c.createBufferSource(); s.buffer = buf;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain(); g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  s.connect(f); f.connect(g); g.connect(c.destination); s.start(at);
}
function tone(c: AudioContext, at: number, freq: number, dur: number, type: OscillatorType, vol: number, to?: number) {
  const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, at); if (to) o.frequency.exponentialRampToValueAtTime(to, at + dur);
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + dur + 0.05);
}
const play = (fn: (c: AudioContext, t: number) => void) => { const c = ac(); if (c) { try { fn(c, c.currentTime); } catch {} } };

export const sfx = {
  deal: () => play((c, t) => noise(c, t, 0.11, 'bandpass', 2600, 0.9, 0.35)),
  dealMany: (n: number) => { for (let i = 0; i < n; i++) setTimeout(() => sfx.deal(), i * 90); },
  flip: () => play((c, t) => { noise(c, t, 0.08, 'bandpass', 3800, 1.2, 0.25); tone(c, t, 520, 0.08, 'triangle', 0.05, 760); }),
  toss: () => play((c, t) => { noise(c, t, 0.13, 'lowpass', 1100, 0.7, 0.45); tone(c, t, 150, 0.12, 'sine', 0.25, 70); }),
  wrong: () => play((c, t) => { tone(c, t, 190, 0.3, 'sawtooth', 0.12, 80); tone(c, t + 0.02, 140, 0.3, 'square', 0.05, 60); }),
  turn: () => play((c, t) => { tone(c, t, 659, 0.22, 'sine', 0.14); tone(c, t + 0.11, 880, 0.3, 'sine', 0.12); }),
  cabo: () => play((c, t) => { [523, 659, 784, 1047].forEach((f, i) => tone(c, t + i * 0.02, f, 1.6, 'sine', 0.11 - i * 0.015)); tone(c, t, 131, 1.4, 'triangle', 0.18); }),
  win: () => play((c, t) => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(c, t + i * 0.12, f, 0.7, 'triangle', 0.13)); }),
  click: () => play((c, t) => tone(c, t, 700, 0.05, 'triangle', 0.05)),
};
export const isMuted = () => muted;
export function setMuted(m: boolean) { muted = m; try { localStorage.setItem('cabo.mute', m ? '1' : '0'); } catch {} if (!m) sfx.click(); }
