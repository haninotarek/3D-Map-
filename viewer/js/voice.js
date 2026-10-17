// Arabic voice guidance for the campus tour, built on the browser Web Speech API:
// no cloud service, no credentials, works fully offline where the browser ships Arabic voices.
// - Lists only voices that actually exist in this runtime (ar-* first, others as fallback).
// - One instruction at a time: a new speak() cancels the previous utterance (no overlap, no per-frame repeats).
// - Every speak is idempotent by id, so milestones fire once even if the event repeats.
// - Pause / resume / cancel follow the tour; the selection and the mute state persist in localStorage.
const LS_VOICE = 'epnu.voice.uri';
const LS_MUTED = 'epnu.voice.muted';

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
    for (const fn of listeners) fn(voices);
    return voices;
  }
  if (synth) { refresh(); synth.addEventListener?.('voiceschanged', refresh); }

  function current() { return voices.find((v) => v.voiceURI === uri) || null; }

  function utter(text, { rate = 0.97, pitch = 1.0 } = {}) {
    const u = new SpeechSynthesisUtterance(text);
    const v = current();
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = lang === 'ar' ? 'ar-EG' : lang; }
    u.rate = rate; u.pitch = pitch; u.volume = 1;
    return u;
  }

  /** Speaks one instruction; id makes it fire once (idempotent), force overrides the guard. */
  function speak(text, id, { force = false, preview = false } = {}) {
    if (!synth) return false;
    if (!preview) {
      if (muted) return false;
      if (id != null && id === lastId && !force) return false;
      if (id != null) lastId = id;
    }
    try { synth.cancel(); synth.speak(utter(text)); return true; } catch (e) { return false; }
  }

  return {
    speak,
    preview: (u) => { if (!synth) return false; try { synth.cancel(); const x = utter(FALLBACK_TEXTS.preview); if (u) { x.voice = u; x.lang = u.lang; } synth.speak(x); return true; } catch (e) { return false; } },
    cancel: () => { lastId = null; try { synth?.cancel(); } catch (e) { /* ignore */ } },
    reset: () => { lastId = null; },
    pause: () => { try { synth?.pause(); } catch (e) { /* ignore */ } },
    resume: () => { try { synth?.resume(); } catch (e) { /* ignore */ } },
    setVoiceByURI: (u) => {
      uri = u;
      try { localStorage.setItem(LS_VOICE, u || ''); } catch (e) { /* ignore */ }
    },
    toggleMute: () => {
      muted = !muted;
      if (muted) try { synth?.cancel(); } catch (e) { /* ignore */ }
      try { localStorage.setItem(LS_MUTED, muted ? '1' : '0'); } catch (e) { /* ignore */ }
      return muted;
    },
    onVoicesChanged: (fn) => { listeners.push(fn); fn(voices); },
    refresh,
    get supported() { return !!synth; },
    get muted() { return muted; },
    get voices() { return voices; },
    get selectedURI() { return uri; },
    get hasArabic() { return voices.some((v) => v.lang.toLowerCase().startsWith('ar')); },
    arriveText: FALLBACK_TEXTS.arrive,
    unavailableText: FALLBACK_TEXTS.unavailable,
  };
}
