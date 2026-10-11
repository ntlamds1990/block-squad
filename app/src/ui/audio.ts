// Sound effects made on the fly with WebAudio, so there are no sound files to download.
export type Sfx =
  | 'click' | 'step' | 'swing' | 'arrow' | 'bolt' | 'hit' | 'graze' | 'boom' | 'heal' | 'build' | 'dig'
  | 'smash' | 'death' | 'summon' | 'guard' | 'turn' | 'win' | 'lose' | 'fire' | 'hex';

const MUTE_KEY = 'blockSquad.muted';
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

export function isMuted() { return muted; }
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* private mode */ }
  if (master) master.gain.value = m ? 0 : 0.5;
}

// Browsers only allow sound after the first tap, so this is called from tap handlers
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, at = 0, slideTo?: number) {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur: number, vol: number, at = 0, filterFreq = 1200, type: BiquadFilterType = 'lowpass') {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + at;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = filterFreq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

export function play(s: Sfx) {
  if (muted || !ctx) return;
  switch (s) {
    case 'click': tone(660, 0.05, 'square', 0.08); break;
    case 'step': noise(0.05, 0.12, 0, 600); break;
    case 'swing': noise(0.14, 0.18, 0, 2500, 'bandpass'); break;
    case 'arrow': noise(0.18, 0.12, 0, 4000, 'highpass'); tone(900, 0.12, 'sine', 0.04, 0, 500); break;
    case 'bolt': tone(500, 0.2, 'sawtooth', 0.08, 0, 1200); break;
    case 'hex': tone(300, 0.25, 'triangle', 0.1, 0, 700); tone(450, 0.25, 'triangle', 0.06, 0.05, 900); break;
    case 'hit': tone(160, 0.15, 'square', 0.18, 0, 70); noise(0.08, 0.2, 0, 900); break;
    case 'graze': tone(240, 0.1, 'triangle', 0.1, 0, 180); break;
    case 'boom': noise(0.6, 0.45, 0, 500); tone(90, 0.5, 'sine', 0.3, 0, 40); break;
    case 'fire': noise(0.4, 0.12, 0, 1500, 'bandpass'); break;
    case 'heal': [523, 659, 784].forEach((f, i) => tone(f, 0.25, 'sine', 0.12, i * 0.08)); break;
    case 'build': tone(200, 0.08, 'square', 0.12); tone(150, 0.1, 'square', 0.1, 0.07); break;
    case 'dig': noise(0.12, 0.2, 0, 800); tone(300, 0.06, 'square', 0.06); break;
    case 'smash': noise(0.3, 0.35, 0, 700); tone(110, 0.25, 'square', 0.15, 0, 50); break;
    case 'death': tone(400, 0.35, 'square', 0.1, 0, 90); break;
    case 'summon': tone(200, 0.4, 'sawtooth', 0.08, 0, 600); noise(0.3, 0.08, 0.1, 2000, 'bandpass'); break;
    case 'guard': tone(440, 0.08, 'square', 0.08); tone(660, 0.12, 'square', 0.08, 0.08); break;
    case 'turn': tone(523, 0.12, 'triangle', 0.12); tone(784, 0.18, 'triangle', 0.12, 0.1); break;
    case 'win': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, 'square', 0.1, i * 0.14)); break;
    case 'lose': [392, 330, 262].forEach((f, i) => tone(f, 0.4, 'triangle', 0.12, i * 0.2)); break;
  }
}
