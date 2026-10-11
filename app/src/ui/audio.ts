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
  startMusic();
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

/* ---------- Music: two short loops written as notes and played with WebAudio ---------- */

export type Track = 'camp' | 'battle';
const MUSIC_KEY = 'blockSquad.music';
let musicOn = (() => { try { return localStorage.getItem(MUSIC_KEY) !== '0'; } catch { return true; } })();
let want: Track | null = null;
let playing: Track | null = null;
let musicGain: GainNode | null = null;
let timer: number | undefined;
let step = 0;
let nextTime = 0;

// Notes as MIDI numbers (60 = middle C), one per eighth note; 0 is a rest
interface Song { bpm: number; chords: number[][]; melody: number[]; bass: number[]; drums: string; vol: number }
const SONGS: Record<Track, Song> = {
  // Camp: a gentle tune in C major (C, A minor, F, G), plucked like a lute
  camp: {
    bpm: 92, vol: 0.9,
    chords: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]],
    melody: [
      72, 0, 74, 76, 79, 0, 76, 74, 72, 0, 69, 0, 72, 74, 76, 0,
      77, 0, 76, 74, 72, 0, 74, 0, 74, 0, 76, 74, 71, 0, 67, 0,
      72, 0, 74, 76, 79, 0, 81, 79, 76, 0, 74, 0, 72, 74, 76, 0,
      77, 76, 74, 72, 74, 0, 72, 0, 71, 0, 74, 0, 72, 0, 0, 0
    ],
    bass: [48, 0, 0, 0, 55, 0, 0, 0, 45, 0, 0, 0, 52, 0, 0, 0, 41, 0, 0, 0, 48, 0, 0, 0, 43, 0, 0, 0, 50, 0, 0, 0],
    drums: ''
  },
  // Battle: a driving tune in A minor (A minor, F, G, E) with drums
  battle: {
    bpm: 132, vol: 0.75,
    chords: [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 56, 59]],
    melody: [
      69, 0, 72, 0, 76, 74, 72, 71, 69, 0, 0, 64, 69, 0, 71, 72,
      72, 0, 69, 0, 65, 0, 69, 72, 77, 76, 74, 72, 74, 0, 0, 0,
      74, 0, 71, 0, 67, 0, 71, 74, 79, 77, 76, 74, 76, 0, 74, 72,
      71, 0, 68, 0, 64, 0, 68, 71, 76, 0, 74, 0, 71, 0, 68, 0
    ],
    bass: [45, 45, 57, 45, 45, 45, 57, 45, 41, 41, 53, 41, 41, 41, 53, 41, 43, 43, 55, 43, 43, 43, 55, 43, 40, 40, 52, 40, 40, 40, 52, 40],
    drums: 'k-h-s-h-k-k-s-h-'
  }
};

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function note(m: number, t0: number, dur: number, type: OscillatorType, vol: number, filter?: number) {
  if (!ctx || !musicGain) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(hz(m), t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let out: AudioNode = g;
  if (filter) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; g.connect(f); out = f; }
  o.connect(g);
  out.connect(musicGain);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function drum(kind: string, t0: number) {
  if (!ctx || !musicGain) return;
  if (kind === 'k') {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(130, t0);
    o.frequency.exponentialRampToValueAtTime(45, t0 + 0.12);
    g.gain.setValueAtTime(0.5, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
    o.connect(g).connect(musicGain);
    o.start(t0); o.stop(t0 + 0.2);
    return;
  }
  const len = Math.floor(ctx.sampleRate * (kind === 's' ? 0.14 : 0.04));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = kind === 's' ? 'bandpass' : 'highpass';
  f.frequency.value = kind === 's' ? 1800 : 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(kind === 's' ? 0.28 : 0.08, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + (kind === 's' ? 0.14 : 0.04));
  src.connect(f).connect(g).connect(musicGain);
  src.start(t0);
}

function scheduleStep(song: Song, i: number, t0: number) {
  const eighth = 60 / song.bpm / 2;
  const v = song.vol;
  const bar = Math.floor(i / 8) % song.chords.length;
  if (i % 8 === 0) for (const m of song.chords[bar]) note(m, t0, eighth * 8, 'sine', 0.035 * v);
  if (i % 8 === 4 && playing === 'camp') for (const m of song.chords[bar]) note(m + 12, t0, eighth * 1.5, 'triangle', 0.03 * v);
  const mel = song.melody[i % song.melody.length];
  if (mel) note(mel, t0, eighth * (playing === 'camp' ? 2.2 : 1.6), playing === 'camp' ? 'triangle' : 'square', (playing === 'camp' ? 0.09 : 0.035) * v, playing === 'camp' ? undefined : 2200);
  const b = song.bass[i % song.bass.length];
  if (b) note(b, t0, eighth * (playing === 'camp' ? 3.5 : 0.9), playing === 'camp' ? 'sine' : 'square', (playing === 'camp' ? 0.12 : 0.05) * v, 600);
  if (song.drums) { const d = song.drums[i % song.drums.length]; if (d !== '-') drum(d, t0); }
}

function tick() {
  if (!ctx || !playing) return;
  const song = SONGS[playing];
  const eighth = 60 / song.bpm / 2;
  while (nextTime < ctx.currentTime + 0.25) {
    scheduleStep(song, step, nextTime);
    nextTime += eighth;
    step++;
  }
}

function startMusic() {
  if (!ctx || !master || playing === want) return;
  stopMusic();
  if (!want || !musicOn) return;
  musicGain = ctx.createGain();
  musicGain.gain.setValueAtTime(0.0001, ctx.currentTime);
  musicGain.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 1.2);
  musicGain.connect(master);
  playing = want;
  step = 0;
  nextTime = ctx.currentTime + 0.1;
  tick();
  timer = window.setInterval(tick, 100);
}

function stopMusic() {
  if (timer !== undefined) { clearInterval(timer); timer = undefined; }
  if (musicGain && ctx) {
    const g = musicGain;
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    setTimeout(() => g.disconnect(), 700);
  }
  musicGain = null;
  playing = null;
}

// Pick the tune for the current screen (null for silence). Starts after the first tap unlocks sound.
export function setMusic(t: Track | null) {
  want = t;
  startMusic();
}
export const isMusicOn = () => musicOn;
export function setMusicOn(on: boolean) {
  musicOn = on;
  try { localStorage.setItem(MUSIC_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  if (on) startMusic(); else stopMusic();
}
