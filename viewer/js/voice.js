// Arabic voice guidance for the campus tour — Egyptian colloquial edition (short & slow).
// Playback policy that fixes mid-sentence cut-offs:
//   • a small speak QUEUE: a new instruction never kills the one playing; it waits (or
//     interrupts only when explicitly urgent, e.g. stairs/doors/floors/arrival).
//   • coalescing: if a queued cue becomes obsolete before playing, it is skipped.
// Engine priority: pre-rendered colloquial cues (cache-first) → browser Web Speech → local espeak bridge.
// - speak() stays idempotent by id (no per-frame repeats).
// - Selection & mute persist in localStorage; mute fades out instead of hard-cutting.
const LS_VOICE = 'epnu.voice.uri';
const LS_MUTED = 'epnu.voice.muted';
const TTS_BASE = (import.meta.env && import.meta.env.VITE_TTS_URL) || '';

const CUE_FILES = {
  welcome: 'audio/cues/welcome.mp3',
  gate: 'audio/cues/gate.mp3',
  halfway: 'audio/cues/halfway.mp3',
  approach: 'audio/cues/approach.mp3',
  enter: 'audio/cues/enter.mp3',
  to_stairs: 'audio/cues/to_stairs.mp3',
  stairs_start: 'audio/cues/stairs_start.mp3',
  climb_1: 'audio/cues/climb_1.mp3',
  floor_1: 'audio/cues/floor_1.mp3',
  floor_2: 'audio/cues/floor_2.mp3',
  floor_3: 'audio/cues/floor_3.mp3',
  // directional cues composed per route: greeting/building -> direct stair climb -> floor + turn
  greeting_gate: 'audio/cues/greeting_gate.mp3',
  go_eng1: 'audio/cues/go_eng1.mp3',
  go_eng2: 'audio/cues/go_eng2.mp3',
  stairs_right_floor_1: 'audio/cues/stairs_right_floor_1.mp3',
  stairs_right_floor_2: 'audio/cues/stairs_right_floor_2.mp3',
  stairs_right_floor_3: 'audio/cues/stairs_right_floor_3.mp3',
  stairs_left_floor_1: 'audio/cues/stairs_left_floor_1.mp3',
  stairs_left_floor_2: 'audio/cues/stairs_left_floor_2.mp3',
  stairs_left_floor_3: 'audio/cues/stairs_left_floor_3.mp3',
  stairs_right: 'audio/cues/stairs_right.mp3',
  stairs_left: 'audio/cues/stairs_left.mp3',
  upto_floor_1: 'audio/cues/upto_floor_1.mp3',
  upto_floor_2: 'audio/cues/upto_floor_2.mp3',
  upto_floor_3: 'audio/cues/upto_floor_3.mp3',
  turn_right: 'audio/cues/turn_right.mp3',
  turn_left: 'audio/cues/turn_left.mp3',
  go_straight: 'audio/cues/go_straight.mp3',
  corridor: 'audio/cues/corridor.mp3',
  arrived: 'audio/cues/arrived.mp3',
  gen_out: 'audio/cues/gen_out.mp3',
  gen_room: 'audio/cues/gen_room.mp3',
  preview: 'audio/cues/preview.mp3',
};
// cues that may interrupt whatever is playing (spatially critical moments)
const INTERRUPT_CUES = new Set(['enter', 'stairs_right', 'stairs_left', 'stairs_right_floor_1', 'stairs_right_floor_2', 'stairs_right_floor_3', 'stairs_left_floor_1', 'stairs_left_floor_2', 'stairs_left_floor_3', 'upto_floor_1', 'upto_floor_2', 'upto_floor_3', 'floor_1', 'floor_2', 'floor_3', 'turn_right', 'turn_left', 'go_straight', 'arrived']);
const MAX_QUEUE = 4;                    // drop queue overflow instead of stacking stale speech (a cue sequence counts as one instruction)
const MAX_WAIT_MS = 25000;              // a queued item that waited too long is skipped
let cuesAvailable = null;

const FALLBACK_TEXTS = {
  arrive: 'خلاص، وصلت. بالتوفيق!',
  preview: 'أهلاً بيك. ده صوت المرشد بتاعك في الجامعة.',
  unavailable: 'الصوت مش شغال على الجهاز ده.',
};
// pre-rendered cues play a touch slower than recorded (pitch preserved) — clear, unhurried guidance
const CUE_RATE = 0.9;

export function createVoice({ lang = 'ar' } = {}) {
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  let voices = [];
  let uri = null;
  let muted = false;
  let lastId = null;
  const listeners = [];

  // ---- playback queue -------------------------------------------------
  let nowPlaying = null;                   // { el, fadeTimer, isPreview }
  const queue = [];                     // [{ cue, text, id, enqueuedAt }]
  const FADE_MS = 380;                  // soft fade — no audible click on interruption

  function stopCurrent(fade = true) {
    if (!nowPlaying) return;
    const { el, fadeTimer } = nowPlaying;
    if (fadeTimer) clearInterval(fadeTimer);
    if (fade && el.volume > 0.01) {
      const v0 = el.volume; const t0 = performance.now();
      const ft = setInterval(() => {
        const k = (performance.now() - t0) / FADE_MS;
        if (k >= 1) { el.volume = 0; el.pause(); clearInterval(ft); }
        else el.volume = v0 * (1 - k);
      }, 20);
      nowPlaying = { ...nowPlaying, fadeTimer: ft };
      setTimeout(() => { try { el.pause(); } catch (e) { /* */ } }, FADE_MS + 40);
    } else {
      try { el.pause(); } catch (e) { /* */ }
    }
    nowPlaying = null;
  }

  function pump() {
    if (nowPlaying || muted) return;
    // drop stale queued items (waited too long or superseded)
    const now = performance.now();
    while (queue.length && now - queue[0].enqueuedAt > MAX_WAIT_MS) queue.shift();
    const item = queue.shift();
    if (!item) return;
    if (!playItem(item)) pump();   // e.g. a later fragment of a sequence whose first fragment already spoke the fallback text
  }

  function playItem({ cue, text }) {
    const file = cue && CUE_FILES[cue];
    if (file && cuesAvailable) {
      const el = new Audio(file);
      el.volume = 1; el.playbackRate = CUE_RATE; el.preservesPitch = true;
      nowPlaying = { el };
      el.addEventListener('ended', () => { if (nowPlaying && nowPlaying.el === el) { nowPlaying = null; pump(); } });
      el.addEventListener('pause', () => { if (nowPlaying && nowPlaying.el === el && !nowPlaying.paused) { nowPlaying = null; pump(); } });
      el.play().catch(() => { nowPlaying = null; pump(); });
      return true;
    }
    // fallback engines speak synchronously; keep the queue moving via utterance end
    if (engine === 'webspeech' && synth && text) {
      try {
        const u = utter(text);
        const wrap = { el: { pause: () => { try { synth.cancel(); } catch (e) { /* */ } }, volume: 1 } };
        nowPlaying = wrap;
        u.onend = u.onerror = () => { if (nowPlaying === wrap) { nowPlaying = null; pump(); } };
        synth.cancel(); synth.speak(u);
        return true;
      } catch (e) { /* fall to bridge */ }
    }
    if (text) return speakBridge(text);
    return false;
  }

  /** cue may be one cue id or an ordered sequence of fragments spoken as one instruction. */
  function enqueue(cue, text, { interrupt = false } = {}) {
    if (muted) return false;
    const list = (Array.isArray(cue) ? cue : cue ? [cue] : []).filter(Boolean);
    if (interrupt) { queue.length = 0; stopCurrent(true); }
    else while (queue.length && queue.length + Math.max(1, list.length) > MAX_QUEUE) queue.shift();
    const enqueuedAt = performance.now();
    if (!list.length) queue.push({ cue: null, text, enqueuedAt });
    else list.forEach((c, i) => queue.push({ cue: c, text: i === 0 ? text : '', enqueuedAt }));
    if (!nowPlaying) pump();
    return true;
  }

  // ---------------------------------------------------------------------
  try { muted = localStorage.getItem(LS_MUTED) === '1'; } catch (e) { /* private mode */ }
  try { uri = localStorage.getItem(LS_VOICE) || null; } catch (e) { /* ignore */ }

  let engine = 'none';
  const arFirst = (a, b) => {
    const A = a.lang.toLowerCase().startsWith('ar'), B = b.lang.toLowerCase().startsWith('ar');
    if (A !== B) return A ? -1 : 1;
    return a.name.localeCompare(b.name);
  };

  function refresh() {
    if (!synth) return [];
    voices = (synth.getVoices() || []).slice().sort(arFirst);
    if (uri && !voices.some((v) => v.voiceURI === uri)) uri = voices[0]?.voiceURI ?? null;
    if (!uri) uri = voices.find((v) => v.lang.toLowerCase().startsWith(lang))?.voiceURI ?? voices[0]?.voiceURI ?? null;
    engine = voices.length ? 'webspeech' : 'bridge';
    for (const fn of listeners) fn(voices);
    return voices;
  }
  if (synth) { refresh(); synth.addEventListener?.('voiceschanged', refresh); }

  function currentVoice() { return voices.find((v) => v.voiceURI === uri) || null; }

  function utter(text) {
    const u = new SpeechSynthesisUtterance(text);
    const v = currentVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = lang === 'ar' ? 'ar-EG' : lang; }
    u.rate = 0.8; u.pitch = 1.0; u.volume = 1;   // بطيء وواضح
    return u;
  }

  function speakBridge(text) {
    try {
      const u = new URL('tts', TTS_BASE || location.origin);
      u.pathname = (TTS_BASE ? new URL(TTS_BASE).pathname.replace(/\/$/, '') : '') + '/tts';
      u.searchParams.set('text', text);
      const el = new Audio(u.toString()); el.playbackRate = CUE_RATE; el.preservesPitch = true;
      nowPlaying = { el };
      el.addEventListener('ended', () => { if (nowPlaying && nowPlaying.el === el) { nowPlaying = null; pump(); } });
      el.play().catch(() => { nowPlaying = null; pump(); });
      return true;
    } catch (e) { return false; }
  }

  async function cuesReady() {
    if (cuesAvailable !== null) return cuesAvailable;
    try {
      const r = await fetch(CUE_FILES.go_straight);
      if (r.body) await r.arrayBuffer();
      cuesAvailable = r.ok;
    } catch (e) { cuesAvailable = false; }
    return cuesAvailable;
  }

  /** Speaks one instruction. id = idempotency key; cue = pre-rendered cue id. */
  function speak(text, id, { force = false, preview = false, cue, interrupt } = {}) {
    if (!preview) {
      if (muted) return false;
      if (id != null && id === lastId && !force) return false;
      if (id != null) lastId = id;
    }
    const cueList = (Array.isArray(cue) ? cue : cue ? [cue] : []).filter(Boolean);
    if (!text && !cueList.length) return false;
    // previews always interrupt (user explicitly asked to hear this voice)
    if (preview) { queue.length = 0; stopCurrent(true); return playItem({ cue: 'preview', text: FALLBACK_TEXTS.preview }); }
    const doInterrupt = interrupt !== undefined ? !!interrupt : cueList.some((c) => INTERRUPT_CUES.has(c));
    return enqueue(cueList, text, { interrupt: doInterrupt });
  }

  async function speakA(text, id, { cue, ...opts } = {}) {
    if (!muted && id != null && id === lastId && !opts.force) return false;
    await cuesReady();
    return speak(text, id, { ...opts, cue });
  }

  return {
    speak,
    speakA,
    preview: () => {
      if (muted) return false;
      queue.length = 0; stopCurrent(true);
      return playItem(cuesAvailable ? { cue: 'preview' } : { text: FALLBACK_TEXTS.preview });
    },
    cancel: () => { lastId = null; queue.length = 0; stopCurrent(true); },
    reset: () => { lastId = null; },
    pause: () => { if (nowPlaying) nowPlaying.paused = true; try { nowPlaying?.el.pause?.(); synth?.pause(); } catch (e) { /* */ } },
    resume: () => { if (nowPlaying) nowPlaying.paused = false; try { nowPlaying?.el.play?.().catch(() => {}); synth?.resume(); } catch (e) { /* */ } },
    setVoiceByURI: (u) => { uri = u; try { localStorage.setItem(LS_VOICE, u || ''); } catch (e) { /* */ } },
    toggleMute: () => {
      muted = !muted;
      if (muted) { queue.length = 0; stopCurrent(true); }
      else pump();
      try { localStorage.setItem(LS_MUTED, muted ? '1' : '0'); } catch (e) { /* */ }
      return muted;
    },
    onVoicesChanged: (fn) => { listeners.push(fn); fn(voices); },
    refresh,
    initCues: async () => { await cuesReady(); return cuesAvailable; },
    get supported() { return !!synth || engine === 'bridge'; },
    get muted() { return muted; },
    get voices() { return voices; },
    get selectedURI() { return uri; },
    get hasArabic() { return voices.some((v) => v.lang.toLowerCase().startsWith('ar')); },
    get cuesReady() { return !!cuesAvailable; },
    get engine() { return cuesAvailable ? 'cues' : engine; },
    get queueLength() { return queue.length + (nowPlaying ? 1 : 0); },
    arriveText: FALLBACK_TEXTS.arrive,
    unavailableText: FALLBACK_TEXTS.unavailable,
  };
}
