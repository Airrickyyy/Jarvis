import { RECOG_LANG, SPEAK_LANG } from "./constants.js";

function getRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

/**
 * Browser speech synthesis (British-leaning fallback when ElevenLabs is off).
 * @param {string} text
 * @returns {Promise<void>}
 */
/** Picks en-GB when available so the offline fallback matches the "Jarvis" register better. */
function pickBritishVoice() {
  const list = speechSynthesis.getVoices();
  if (!list.length) return null;
  const enGb = list.filter((v) => v.lang.toLowerCase().startsWith("en-gb"));
  const maleish = /male|daniel|oliver|thomas|arthur|george|james|william|fred/i;
  return (
    enGb.find((v) => maleish.test(v.name)) ||
    enGb[0] ||
    list.find((v) => v.lang.toLowerCase().startsWith("en-au")) ||
    null
  );
}

export function speak(text) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) {
      resolve();
      return;
    }

    speechSynthesis.cancel();

    const u = new SpeechSynthesisUtterance(text);
    u.lang = SPEAK_LANG;
    u.rate = 0.92;
    u.pitch = 1;
    u.onend = () => resolve();
    u.onerror = () => resolve();

    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      const voice = pickBritishVoice();
      if (voice) u.voice = voice;
      speechSynthesis.speak(u);
    };

    if (speechSynthesis.getVoices().length) {
      start();
    } else {
      speechSynthesis.addEventListener("voiceschanged", start, { once: true });
      window.setTimeout(start, 500);
    }
  });
}

/**
 * @param {{
 *   onRollup: (args: {
 *     fullPhrase: string;
 *     deltaFinalsJoined: string;
 *   }) => void,
 *   onError?: (e: SpeechRecognitionErrorEvent) => void
 * }} opts
 */
export function createRecognitionSession({ onRollup, onError }) {
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    return {
      supported: false,
      start() {},
      stop() {},
      restartFresh() {},
    };
  }

  /** @type {SpeechRecognition | null} */
  let recognition = null;
  /** @type {boolean} */
  let shouldLoop = false;
  /** @type {boolean} */
  let spawning = false;

  function assembleBestPhrase(results) {
    let out = "";
    for (let i = 0; i < results.length; i += 1) {
      const r = results[i];
      out += `${r[r.length - 1].transcript}`;
    }
    return out.replace(/\s+/g, " ").trim();
  }

  function deltaFinalTexts(results, fromIndex) {
    /** @type {string[]} */
    const deltas = [];

    for (let i = fromIndex; i < results.length; i += 1) {
      const r = /** @type {SpeechRecognitionResult} */ (results[i]);
      const piece = `${r[r.length - 1].transcript}`.trim();
      if (!r.isFinal || !piece) continue;
      deltas.push(piece);
    }

    return deltas.join(" ").replace(/\s+/g, " ").trim();
  }

  function makeInstance() {
    const rec = new Ctor();
    rec.lang = RECOG_LANG;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event) => {
      const fullPhrase = assembleBestPhrase(event.results).trim();
      const deltaFinalsJoined = deltaFinalTexts(event.results, event.resultIndex);
      onRollup({ fullPhrase, deltaFinalsJoined });
    };

    rec.onerror = (e) => {
      if (onError) onError(e);
    };

    rec.onend = () => {
      if (shouldLoop && !spawning) {
        spawning = true;
        recognition = makeInstance();
        try {
          recognition.start();
        } catch {
          /**/
        }
        spawning = false;
      }
    };

    return rec;
  }

  recognition = null;

  return {
    supported: true,

    /** Clears buffered hypotheses (best-effort restart). Use when arming wake. */
    restartFresh() {
      shouldLoop = true;
      spawning = false;
      if (recognition) {
        try {
          recognition.abort();
        } catch {
          /**/
        }
      }
      recognition = makeInstance();
      try {
        recognition.start();
      } catch {
        /**/
      }
    },

    start() {
      shouldLoop = true;
      spawning = false;
      recognition = recognition || makeInstance();
      try {
        recognition.start();
      } catch {
        /**/
      }
    },

    stop() {
      shouldLoop = false;
      spawning = false;
      if (!recognition) return;
      try {
        recognition.abort();
      } catch {
        /**/
      }
      recognition = null;
    },
  };
}
