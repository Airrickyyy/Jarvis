import {
  CLAP_AUDIO_THRESHOLD_BASE,
  WAKE_PHRASE_REGEX,
  WAKE_PHRASE_WINDOW_MS,
} from "./constants.js";
import { createClapDetector } from "./clapDetector.js";
import {
  relayJsonToButtonParse,
} from "./commandParser.js";
import { createRecognitionSession, speak } from "./voice.js";
import {
  resolveCredentials,
  runGroqRelayTurn,
  speakWithElevenLabsSentences,
} from "./aiService.js";

/** UI / engine states */
const States = /** @type {const} */ ({
  STANDBY: "standby",
  LISTENING: "listening",
  ARMED_WAKEUP: "armed_wakeup",
  SPEAKING: "speaking",
  ACTIVE: "active_ai",
});

/** @typedef {'A' | 'B' | 'C' | 'D'} ButtonId */

const BUTTON_IDS = /** @type {ButtonId[]} */ (["A", "B", "C", "D"]);

const startBtn = document.getElementById("startJarvisBtn");
const stateLabelEl = document.getElementById("stateLabel");
const pulseDotEl = document.getElementById("pulseDot");
const subtitleEl = document.getElementById("subtitle");
const hintTextEl = document.getElementById("hintText");
const speechNoteEl = document.getElementById("speechSupportNote");
const insecureWarningEl = document.getElementById("insecureWarning");
const relayGlowEl = document.getElementById("relayGlow");

/** @type {Record<ButtonId, boolean>} */
const buttonOn = Object.fromEntries(BUTTON_IDS.map((id) => [id, false]));

/** Conversation memory (user/assistant only). */
/** @type {import('./commandParser.js').ChatTurn[]} */
let chatTurns = [];

/** @type { keyof typeof States } */
let appState = States.STANDBY;

let wakeHandshakePending = false;

let audioCtx = /** @type {AudioContext | null} */ (null);
/** @type {MediaStream | null} */
let mediaStream = null;
const clapper = createClapDetector({ onDoubleClap: handleDoubleClap });

let armTimerId = null;
let armDeadlineTs = 0;

let lastUtteranceFp = "";
let lastUtteranceTs = 0;

/** Prevents stacking AI exchanges. */
let exchangeLock = false;

function setRelaySpeakingVisual(active) {
  if (!relayGlowEl) return;
  relayGlowEl.classList.toggle("opacity-0", !active);
  relayGlowEl.classList.toggle("opacity-65", !!active);
  relayGlowEl.classList.toggle("animate-pulse", !!active);
}

function setState(next) {
  appState = next;

  const dotBase =
    "h-2 w-2 shrink-0 rounded-full shadow-[0_0_14px_currentColor] transition-colors duration-300 ";
  let dotExtra = "";
  if (next === States.ACTIVE) {
    dotExtra = "bg-emerald-400 text-emerald-400";
  } else if (next === States.SPEAKING) {
    dotExtra = "bg-amber-400 text-amber-400";
  } else if (next === States.ARMED_WAKEUP) {
    dotExtra = "bg-indigo-400 text-indigo-400";
  } else if (next === States.LISTENING) {
    dotExtra = "bg-slate-300 text-slate-300";
  } else {
    dotExtra = "bg-slate-500 text-slate-500";
  }
  pulseDotEl.className = dotBase + dotExtra;

  const map = {
    [States.STANDBY]: "Standby",
    [States.LISTENING]: "Clap‑wait",
    [States.ARMED_WAKEUP]: "Wake phrase",
    [States.SPEAKING]: "Jarvis Speaking",
    [States.ACTIVE]: "Jarvis Active",
  };
  stateLabelEl.textContent = map[next];

  if (next === States.ACTIVE) {
    hintTextEl.textContent =
      "Conversation mode — relays still obey deterministic JSON tool calls from Groq. Say “Stand down”.";
  } else if (next === States.SPEAKING) {
    hintTextEl.textContent =
      "Speech capture paused — avoid feedback while ElevenLabs / fallback audio plays.";
  } else if (next === States.ARMED_WAKEUP) {
    hintTextEl.textContent = `Articulate “wake up” (${Math.round(
      WAKE_PHRASE_WINDOW_MS / 1000
    )}s window • another double-clap refreshes)`;
  } else if (next === States.LISTENING) {
    hintTextEl.textContent = `Double-clap (${CLAP_AUDIO_THRESHOLD_BASE} RMS base) unlocks Jarvis handshake.`;
  } else {
    hintTextEl.textContent = "Engines cold — press Start.";
  }
}

function refreshButtonsUi() {
  BUTTON_IDS.forEach((id) => {
    const el = document.getElementById(`btn${id}`);
    if (!el) return;

    const on = buttonOn[id];
    el.classList.toggle("opacity-35", !on);
    el.classList.toggle("grayscale", !on);
    el.classList.toggle("text-slate-500", !on);
    el.classList.toggle("border-emerald-500/60", on);
    el.classList.toggle("bg-emerald-500/15", on);
    el.classList.toggle("text-emerald-200", on);
    el.classList.toggle("shadow-[inset_0_0_0_1px_rgba(74,222,128,0.35)]", on);
    el.classList.toggle("ring-2", on);
    el.classList.toggle("ring-emerald-400/50", on);
  });
}

function clearArmTimer() {
  if (armTimerId !== null) {
    clearTimeout(armTimerId);
    armTimerId = null;
  }
}

function resetSessionFlags() {
  lastUtteranceFp = "";
  lastUtteranceTs = 0;
  wakeHandshakePending = false;
  exchangeLock = false;
}

async function teardownSession() {
  clearArmTimer();
  clapper.stop();
  recognition.stop();
  chatTurns = [];
  resetSessionFlags();

  if (audioCtx) {
    try {
      await audioCtx.close();
    } catch {
      /**/
    }
    audioCtx = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }

  BUTTON_IDS.forEach((id) => {
    buttonOn[id] = false;
  });
  refreshButtonsUi();
  setRelaySpeakingVisual(false);
}

async function initialiseAudioStack() {
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    video: false,
  });

  audioCtx = new AudioContext({ latencyHint: "interactive" });
  await audioCtx.resume();
  clapper.start(audioCtx, mediaStream);

  subtitleEl.textContent =
    "Thermal sensors calibrated. Awaiting double‑clap to arm conversational core.";
}

const recognition = createRecognitionSession({
  onRollup: handleSpeechRollup,
  onError: (event) => {
    if (
      event.error === "audio-capture" ||
      event.error === "service-not-allowed"
    ) {
      speechNoteEl.textContent =
        event.error === "audio-capture"
          ? "Need mic access."
          : "Speech service blocked.";
    }
    if (
      event.error === "network" ||
      event.error === "not-allowed" ||
      event.error === "aborted"
    ) {
      hintTextEl.textContent = `Recognition: ${event.error}`;
    }
  },
});

refreshButtonsUi();

function handleDoubleClap() {
  if (appState === States.ACTIVE || appState === States.SPEAKING) return;

  recognition.restartFresh();
  clearArmTimer();
  armDeadlineTs = Date.now() + WAKE_PHRASE_WINDOW_MS;

  armTimerId = window.setTimeout(() => {
    if (appState !== States.ARMED_WAKEUP) return;
    setState(States.LISTENING);
    subtitleEl.textContent =
      "Wake window expired — kindly double‑clap to re‑arm Jarvis.";
  }, WAKE_PHRASE_WINDOW_MS);

  setState(States.ARMED_WAKEUP);
  subtitleEl.textContent = "Hands free — deliver the wake passphrase.";
}

/**
 * Router for speech aggregator.
 */
function handleSpeechRollup({ fullPhrase, deltaFinalsJoined }) {
  if (appState === States.ARMED_WAKEUP) {
    if (Date.now() > armDeadlineTs) return;
    const phrase = `${fullPhrase}`.trim();
    if (phrase.length && WAKE_PHRASE_REGEX.test(phrase)) void completeWakeHandshake();
    return;
  }

  if (appState !== States.ACTIVE) return;

  const chunk = deltaFinalsJoined.trim();
  if (!chunk) return;

  const nowTs = Date.now();
  const fp = chunk.toLowerCase();
  if (fp === lastUtteranceFp && nowTs - lastUtteranceTs < 1100) return;
  lastUtteranceFp = fp;
  lastUtteranceTs = nowTs;

  if (exchangeLock) return;
  void orchestrateAiExchange(chunk);
}

function applyParsedButtons(parsed) {
  if (!parsed) return;

  if (parsed.kind === "all") {
    BUTTON_IDS.forEach((id) => {
      buttonOn[id] = parsed.value;
    });
  } else {
    BUTTON_IDS.forEach((id) => {
      if (parsed.buttons[id] !== undefined) {
        buttonOn[id] = parsed.buttons[id];
      }
    });
  }
  refreshButtonsUi();
}

const STAND_LOCALLY = /\b(go to sleep|stand down)\b/i;

async function orchestrateAiExchange(chunk) {
  if (!audioCtx) return;

  exchangeLock = true;
  recognition.stop();
  setState(States.SPEAKING);
  setRelaySpeakingVisual(true);

  subtitleEl.textContent = `Captured: "${chunk}"`;

  const secrets = resolveCredentials();

  /** @returns {Promise<void>} */
  const jarvisVoice = async (line, options = {}) =>
    utter(line, secrets, !!options.priority);

  /** @returns {Promise<void>} */
  const utter = async (line, sc, urgent) => {
    const trimmed = `${line ?? ""}`.trim();
    if (!trimmed.length) return;

    /** Give WebAudio first shot at user‑gesture stack */
    try {
      await audioCtx.resume();
      await speakWithElevenLabsSentences({
        text: trimmed,
        secrets: sc,
        audioCtx,
        onSentenceStart: (sentence) => {
          subtitleEl.textContent =
            `[Jarvis ▸ ${sentence.length > 80 ? `${sentence.slice(0, 77)}…` : sentence}`;
        },
      });
    } catch (err) {
      console.error(err);
      if (urgent) {
        await speak(trimmed);
      } else {
        await speak(`Pardon interference, Sir. ${trimmed}`);
      }
    }
  };

  /** When true we left ACTIVE for clap‑waiting standby */
  let leftActiveMode = false;

  try {
    if (STAND_LOCALLY.test(chunk)) {
      await jarvisVoice("Standing down, Sir.", { priority: true });
      finalizeStandDown();
      leftActiveMode = true;
      return;
    }

    /** Model turn — history excludes this utterance; runGroq appends fresh user bubble */
    const groqOutcome = await runGroqRelayTurn({
      userText: chunk,
      history: chatTurns,
      secrets,
    });

    const relay = groqOutcome.relayPayload ?? {};
    const reply = `${relay.reply ?? ""}`.trim() || "Acknowledged, Sir.";
    const mustStandDown = Boolean(relay.stand_down || groqOutcome.standDown);

    if (!mustStandDown) {
      const parsed = relayJsonToButtonParse(relay);
      applyParsedButtons(parsed);
    }

    await jarvisVoice(reply);

    if (!mustStandDown) {
      chatTurns.push({ role: "user", content: chunk });
      chatTurns.push({ role: "assistant", content: reply });

      /** ~14 conversational rounds */
      while (chatTurns.length > 28) {
        chatTurns.splice(0, chatTurns.length - 28);
      }
    }

    if (mustStandDown) {
      finalizeStandDown();
      leftActiveMode = true;
    }
  } catch (error) {
    console.error(error);
    subtitleEl.textContent =
      "Groq / Eleven pipeline fault — check network, proxies, keys.";
    await jarvisVoice(
      "My apologies Sir — I lost contact with HQ networks. Shall we retry once circuits settle?",
      { priority: true }
    );
  } finally {
    setRelaySpeakingVisual(false);
    exchangeLock = false;

    if (!leftActiveMode) {
      setState(States.ACTIVE);
      subtitleEl.textContent =
        "Operational — awaiting conversational directives.";
      try {
        recognition.restartFresh();
      } catch {
        /**/
      }
    }
  }
}

function finalizeStandDown() {
  clearArmTimer();
  chatTurns = [];
  lastUtteranceFp = "";

  BUTTON_IDS.forEach((id) => {
    buttonOn[id] = false;
  });
  refreshButtonsUi();

  setState(States.LISTENING);
  subtitleEl.textContent =
    "Standing by for double‑clap re‑arm whenever you desire, Sir.";
  try {
    recognition.restartFresh();
  } catch {
    /**/
  }
}

async function completeWakeHandshake() {
  if (wakeHandshakePending) return;
  if (appState !== States.ARMED_WAKEUP) return;
  wakeHandshakePending = true;

  clearArmTimer();
  setState(States.SPEAKING);
  recognition.stop();

  subtitleEl.textContent = "Wake credentials authenticated — etiquette briefing commencing.";
  setRelaySpeakingVisual(true);

  const secrets = resolveCredentials();

  try {
    if (!audioCtx) throw new Error("missing audioCtx");
    await audioCtx.resume();
    await speakWithElevenLabsSentences({
      text: "Good morning, Sir.",
      secrets,
      audioCtx,
    });

    chatTurns = [];

    setState(States.ACTIVE);
    subtitleEl.textContent =
      "Conversational core engaged — relays await instructions or banter.";
    recognition.restartFresh();
  } catch (error) {
    console.error(error);
    await speak("Good morning, Sir.");
    chatTurns = [];
    setState(States.ACTIVE);
    recognition.restartFresh();
  } finally {
    setRelaySpeakingVisual(false);
    wakeHandshakePending = false;
  }
}

async function bootstrapFromUserGesture() {
  if (!RecognitionCtorAvailable()) {
    speechNoteEl.textContent =
      "SpeechRecognition unsupported in this browser — launch Chrome.";
    return;
  }

  if (!window.isSecureContext) {
    speechNoteEl.textContent =
      "Deploy via http/https — localhost or GitHub Pages. file:// withholds microphones.";
    subtitleEl.textContent =
      "Use Serve‑Local.bat / GitHub Pages, then revisit with a secure URL.";
    insecureWarningEl?.removeAttribute("hidden");
    startBtn.disabled = false;
    return;
  }

  startBtn.disabled = true;
  startBtn.textContent = "Initializing…";

  try {
    await initialiseAudioStack();
    recognition.restartFresh();

    speechNoteEl.textContent =
      "Populate js/credentials.js or window.JARVIS_CONFIG once before serious use.";
    setState(States.LISTENING);
    startBtn.textContent = "Suspend Jarvis mic";
    startBtn.onclick = async () => {
      await teardownSession();
      setState(States.STANDBY);
      subtitleEl.textContent =
        "Press Start to resume — double‑clap, wake phrase, then conversational relay governance.";
      startBtn.disabled = false;
      startBtn.textContent = "Start Jarvis mic";
      refreshButtonsUi();
      startBtn.onclick = bootstrapFromUserGesture;
    };
  } catch (error) {
    console.error(error);
    const code = /** @type {DOMException | Error} */ (error)?.name;
    if (!window.isSecureContext || code === "SecurityError") {
      insecureWarningEl?.removeAttribute("hidden");
    }

    subtitleEl.textContent =
      "Initialization failed — consult console + Chrome permissions.";
    speechNoteEl.textContent = `${code ?? error}`;
    startBtn.disabled = false;
    startBtn.textContent = "Retry bootstrap";
    await teardownSession().catch(() => {});
    setState(States.STANDBY);
  }
}

function RecognitionCtorAvailable() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

if (!RecognitionCtorAvailable()) {
  speechNoteEl.textContent =
    "Requires Chromium SpeechRecognition (desktop Chrome recommended).";
}

setState(States.STANDBY);

startBtn.addEventListener("click", bootstrapFromUserGesture);
