import { RECOG_LANG, SPEAK_LANG } from "./constants.js";

function getRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

/**
 * Browser speech synthesis.
 * @param {string} text
 * @returns {Promise<void>}
 */
export function speak(text) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) {
      resolve();
      return;
    }

    speechSynthesis.cancel();

    const u = new SpeechSynthesisUtterance(text);
    u.lang = SPEAK_LANG;
    u.rate = 1;
    u.onend = () => resolve();
    u.onerror = () => resolve();

    speechSynthesis.speak(u);
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
