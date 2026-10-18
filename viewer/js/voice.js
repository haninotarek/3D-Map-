// Arabic voice guidance for the campus tour.
// Engine priority (both are real, no fictional voices):
//   1. Browser Web Speech voices (best quality; needs system voices on the device)
//   2. Local espeak-ng bridge at /tts (TTT_BASE, served by tts_server.py) when the
//      browser has no voices at all (headless QA, bare Linux) — real Arabic audio.
// If neither is available, guidance stays visual and the picker says so honestly.
// - One instruction at a time: a new speak() cancels the previous one (no overlap).
// - speak() is idempotent by id, so repeated events do not re-announce.
// - Selection & mute persist in localStorage.
const LS_VOICE = 'epnu.voice.uri';
const LS_MUTED = 'epnu.voice.muted';
const TTS_BASE = (import.meta.env && import.meta.env.VITE_TTS_URL) || '';  // e.g. http://host:8081 — empty = same-origin proxy disabled

const FALLBACK_TEXTS = {
  arrive: 'لقد وصلت إلى وجهتك بنجاح. يمكنك الآن التوقف واستكشاف المكان.',
  preview: 'مرحبًا بك. هذا مثال على الصوت المرشد داخل الحرم الجامعي.',
  unavailable: 'الصوت غير متاح على هذا الجهاز أو المتصفح.',
};

export function createVoice({ lang = 'ar' } = {}) {
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  let voices = [];
  let uri = null;
  let muted = false;
  let lastId = null;
  const listeners = [];
  let audio = null;                       // HTMLAudioElement for the bridge engine
  let engine = 'none';                    // 'webspeech' | 'bridge' | 'none'

  try { muted = localStorage.getItem(LS_MUTED) === '1'; } catch (e) { /* private mode */ }
  try { uri = localStorage.getItem(LS_VOICE) || null; } catch (e) { /* ignore */ }

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

  function current() { return voices.find((v) => v.voiceURI === uri) || null; }

  /** Real Arabic audio via the local espeak-ng bridge. */
  function speakBridge(text) {
    try {
      if (audio) { audio.pause(); audio.src = ''; }
      const u = new URL('tts', TTS_BASE || location.origin);
      u.protocol = TTS_BASE ? u.protocol : location.protocol;
      if (TTS_BASE) { /* absolute base already */ }
      u.pathname = (TTS_BASE ? new URL(TTS_BASE).pathname.replace(/\/$/, '') : '') + '/tts';
      u.searchParams.set('text', text);
      audio = new Audio(u.toString());
      audio.play().catch(() => { /* autoplay policy or bridge down */ });
      return true;
    } catch (e) { return false; }
  }

  function utter(text) {
    const u = new SpeechSynthesisUtterance(text);
    const v = current();
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = lang === 'ar' ? 'ar-EG' : lang; }
    u.rate = 0.97; u.pitch = 1.0; u.volume = 1;
    return u;
  }

  /** Speaks one instruction; id makes it fire once (idempotent), force overrides the guard. */
  function speak(text, id, { force = false, preview = false } = {}) {
    if (!preview) {
      if (muted) return false;
      if (id != null && id === lastId && !force) return false;
      if (id != null) lastId = id;
    }
    if (!text) return false;
    if (engine === 'webspeech' && synth) {
      try { synth.cancel(); synth.speak(utter(text)); return true; } catch (e) { /* fall through */ }
    }
    return speakBridge(text);
  }

  return {
    speak,
    preview: (vo) => {
      if (vo && synth) { try { synth.cancel(); const x = utter(FALLBACK_TEXTS.preview); x.voice = vo; x.lang = vo.lang; synth.speak(x); return true; } catch (e) { /* fall */ } }
      if (!synth) return speakBridge(FALLBACK_TEXTS.preview) || false;
      try { synth.cancel(); synth.speak(utter(FALLBACK_TEXTS.preview)); return true; } catch (e) { return false; }
    },
    cancel: () => {
      lastId = null;
      try { synth?.cancel(); } catch (e) { /* ignore */ }
      try { if (audio) { audio.pause(); audio.src = ''; } } catch (e) { /* ignore */ }
    },
    reset: () => { lastId = null; },
    pause: () => { try { synth?.pause(); audio?.pause(); } catch (e) { /* ignore */ } },
    resume: () => { try { synth?.resume(); audio?.play().catch(() => {}); } catch (e) { /* ignore */ } },
    setVoiceByURI: (u) => {
      uri = u;
      try { localStorage.setItem(LS_VOICE, u || ''); } catch (e) { /* ignore */ }
    },
    toggleMute: () => {
      muted = !muted;
      if (muted) { try { synth?.cancel(); audio?.pause(); } catch (e) { /* ignore */ } }
      try { localStorage.setItem(LS_MUTED, muted ? '1' : '0'); } catch (e) { /* ignore */ }
      return muted;
    },
    onVoicesChanged: (fn) => { listeners.push(fn); fn(voices); },
    refresh,
    get supported() { return !!synth || engine === 'bridge'; },
    get muted() { return muted; },
    get voices() { return voices; },
    get selectedURI() { return uri; },
    get hasArabic() { return voices.some((v) => v.lang.toLowerCase().startsWith('ar')); },
    get engine() { return engine; },
    arriveText: FALLBACK_TEXTS.arrive,
    unavailableText: FALLBACK_TEXTS.unavailable,
  };
}
