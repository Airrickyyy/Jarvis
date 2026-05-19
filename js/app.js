import { WAKE_PHRASE_REGEX } from "./constants.js";
import {
  relayJsonToButtonParse,
} from "./commandParser.js";
import { createRecognitionSession, speak } from "./voice.js";
import {
  resolveCredentials,
  runGroqRelayTurn,
  speakWithElevenLabsSentences,
} from "./aiService.js";
import {
  getMergedSecretsSurface,
  isGroqConfiguredMerged,
  saveSecretsToLocalStorage,
} from "./secretsStore.js";

/** UI / engine states */
const States = /** @type {const} */ ({
  STANDBY: "standby",
  LISTENING: "listening",
  SPEAKING: "speaking",
  ACTIVE: "active_ai",
});

/** @typedef {'A' | 'B' | 'C' | 'D'} ButtonId */

const BUTTON_IDS = /** @type {ButtonId[]} */ (["A", "B", "C", "D"]);

const startBtn = document.getElementById("startJarvisBtn");
const configBtn = document.getElementById("configBtn");
const stateLabelEl = document.getElementById("stateLabel");
const pulseDotEl = document.getElementById("pulseDot");
const subtitleEl = document.getElementById("subtitle");
const hintTextEl = document.getElementById("hintText");
const speechNoteEl = document.getElementById("speechSupportNote");
const insecureWarningEl = document.getElementById("insecureWarning");
const relayGlowEl = document.getElementById("relayGlow");

const setupOverlay = document.getElementById("setupOverlay");
const setupGroqKey = /** @type {HTMLInputElement | null} */ (
  document.getElementById("setupGroqKey")
);
const setupGroqProxy = /** @type {HTMLInputElement | null} */ (
  document.getElementById("setupGroqProxy")
);
const setupElevenKey = /** @type {HTMLInputElement | null} */ (
  document.getElementById("setupElevenKey")
);
const setupElevenVoice = /** @type {HTMLInputElement | null} */ (
  document.getElementById("setupElevenVoice")
);
const setupActivateBtn = document.getElementById("setupActivateBtn");
const setupErr = document.getElementById("setupErr");

const keysModalOverlay = document.getElementById("keysModalOverlay");
const keysGroqKey = /** @type {HTMLInputElement | null} */ (
  document.getElementById("keysGroqKey")
);
const keysGroqProxy = /** @type {HTMLInputElement | null} */ (
  document.getElementById("keysGroqProxy")
);
const keysElevenKey = /** @type {HTMLInputElement | null} */ (
  document.getElementById("keysElevenKey")
);
const keysElevenVoice = /** @type {HTMLInputElement | null} */ (
  document.getElementById("keysElevenVoice")
);
const keysSaveBtn = document.getElementById("keysSaveBtn");
const keysCancelBtn = document.getElementById("keysCancelBtn");
const keysModalErr = document.getElementById("keysModalErr");

/** @param {HTMLElement | null} el */
function showOverlayFlex(el) {
  if (!el) return;
  el.classList.remove("hidden");
  el.classList.add("flex");
  el.setAttribute("aria-hidden", "false");
}

/** @param {HTMLElement | null} el */
function hideOverlayFlex(el) {
  if (!el) return;
  el.classList.add("hidden");
  el.classList.remove("flex");
  el.setAttribute("aria-hidden", "true");
}

/** @param {HTMLElement | null} el */
function hideInlineErr(el) {
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
}

/** @param {HTMLElement | null} el @param {string} msg */
function showInlineErr(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
}

/**
 * @param {string} key
 * @param {string} proxy
 * @param {boolean} allowImplicitKeep — modal: blank Groq fields keep stored / creds values
 */
function validateGroqOrProxy(key, proxy, allowImplicitKeep) {
  const k = `${key ?? ""}`.trim();
  const p = `${proxy ?? ""}`.trim();
  if (k.startsWith("gsk_")) return { ok: true };
  if (p) {
    try {
      const u = new URL(p);
      if (u.protocol === "http:" || u.protocol === "https:") return { ok: true };
    } catch {
      /**/
    }
    return {
      ok: false,
      msg: "Proxy must be a valid http(s) URL, or enter a Groq API key starting with gsk_.",
    };
  }
  if (allowImplicitKeep) {
    const s = getMergedSecretsSurface();
    if (s.groqApiKey?.trim() || s.groqProxyUrl?.trim()) return { ok: true };
  }
  return {
    ok: false,
    msg: "Please enter a valid Groq API key (starts with gsk_).",
  };
}

/** @param {Record<string,string>} surface */
function fillSetupForm(surface) {
  if (setupGroqKey) setupGroqKey.value = surface.groqApiKey ?? "";
  if (setupGroqProxy) setupGroqProxy.value = surface.groqProxyUrl ?? "";
  if (setupElevenKey) setupElevenKey.value = surface.elevenLabsApiKey ?? "";
  if (setupElevenVoice) setupElevenVoice.value = surface.elevenLabsVoiceId ?? "";
}

/** @param {Record<string,string>} surface */
function fillKeysModal(surface) {
  if (keysGroqKey) keysGroqKey.value = surface.groqApiKey ?? "";
  if (keysGroqProxy) keysGroqProxy.value = surface.groqProxyUrl ?? "";
  if (keysElevenKey) keysElevenKey.value = surface.elevenLabsApiKey ?? "";
  if (keysElevenVoice) keysElevenVoice.value = surface.elevenLabsVoiceId ?? "";
}

/**
 * @param {{
 *   groqKeyEl: HTMLInputElement | null,
 *   groqProxyEl: HTMLInputElement | null,
 *   elevenKeyEl: HTMLInputElement | null,
 *   elevenVoiceEl: HTMLInputElement | null,
 *   errEl: HTMLElement | null,
 *   allowImplicitGroqKeep?: boolean,
 * }} args
 */
function applySecretsFromInputs({
  groqKeyEl,
  groqProxyEl,
  elevenKeyEl,
  elevenVoiceEl,
  errEl,
  allowImplicitGroqKeep = false,
}) {
  hideInlineErr(errEl);
  const k = groqKeyEl?.value?.trim() ?? "";
  const p = groqProxyEl?.value?.trim() ?? "";
  const ek = elevenKeyEl?.value?.trim() ?? "";
  const ev = elevenVoiceEl?.value?.trim() ?? "";

  const groqCheck = validateGroqOrProxy(k, p, allowImplicitGroqKeep);
  if (!groqCheck.ok) {
    showInlineErr(errEl, groqCheck.msg);
    return false;
  }
  if (ek && !ev) {
    showInlineErr(errEl, "Add a Voice ID when using an ElevenLabs API key, Sir.");
    return false;
  }
  if (!ek && ev) {
    showInlineErr(errEl, "Add the ElevenLabs API key when using a Voice ID.");
    return false;
  }

  /** @type {Record<string,string>} */
  const updates = {};
  if (k.startsWith("gsk_")) {
    updates.groqApiKey = k;
    try {
      localStorage.removeItem("jarvis_groq_key");
    } catch {
      /**/
    }
  }
  if (p) updates.groqProxyUrl = p;
  if (ek) updates.elevenLabsApiKey = ek;
  if (ev) updates.elevenLabsVoiceId = ev;
  saveSecretsToLocalStorage(updates);
  return true;
}

/**
 * First-run setup card or Keys modal (Daily HQ–style Groq capture).
 * @param {{ force?: boolean }} opts
 * @returns {Promise<boolean>} true if user saved new values from a modal/setup form
 */
function waitForKeysUi({ force } = {}) {
  if (!force && isGroqConfiguredMerged()) {
    hideOverlayFlex(setupOverlay);
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const ac = new AbortController();
    const { signal } = ac;
    const surface = getMergedSecretsSurface();

    const finish = (saved) => {
      ac.abort();
      resolve(saved);
    };

    const wireInputClear = (inputs, err) => {
      inputs
        .filter((inp) => inp instanceof HTMLInputElement)
        .forEach((inp) => {
          inp.addEventListener("input", () => hideInlineErr(err), { signal });
        });
    };

    if (force) {
      if (
        !keysModalOverlay ||
        !keysGroqKey ||
        !keysGroqProxy ||
        !keysElevenKey ||
        !keysElevenVoice ||
        !keysSaveBtn ||
        !keysCancelBtn
      ) {
        resolve(false);
        return;
      }

      fillKeysModal(surface);
      hideInlineErr(keysModalErr);
      showOverlayFlex(keysModalOverlay);

      const save = () => {
        if (
          !applySecretsFromInputs({
            groqKeyEl: keysGroqKey,
            groqProxyEl: keysGroqProxy,
            elevenKeyEl: keysElevenKey,
            elevenVoiceEl: keysElevenVoice,
            errEl: keysModalErr,
            allowImplicitGroqKeep: true,
          })
        ) {
          return;
        }
        hideOverlayFlex(keysModalOverlay);
        finish(true);
      };

      const cancel = () => {
        hideOverlayFlex(keysModalOverlay);
        finish(false);
      };

      keysSaveBtn.addEventListener("click", save, { signal });
      keysCancelBtn.addEventListener("click", cancel, { signal });
      keysModalOverlay.addEventListener(
        "click",
        (e) => {
          if (e.target === keysModalOverlay) cancel();
        },
        { signal }
      );
      keysGroqKey.addEventListener(
        "keydown",
        (e) => {
          if (e.key === "Enter") save();
        },
        { signal }
      );
      wireInputClear(
        [keysGroqKey, keysGroqProxy, keysElevenKey, keysElevenVoice],
        keysModalErr
      );
    } else {
      if (
        !setupOverlay ||
        !setupGroqKey ||
        !setupGroqProxy ||
        !setupElevenKey ||
        !setupElevenVoice ||
        !setupActivateBtn
      ) {
        resolve(false);
        return;
      }

      fillSetupForm(surface);
      hideInlineErr(setupErr);
      showOverlayFlex(setupOverlay);

      const activate = () => {
        if (
          !applySecretsFromInputs({
            groqKeyEl: setupGroqKey,
            groqProxyEl: setupGroqProxy,
            elevenKeyEl: setupElevenKey,
            elevenVoiceEl: setupElevenVoice,
            errEl: setupErr,
            allowImplicitGroqKeep: false,
          })
        ) {
          return;
        }
        hideOverlayFlex(setupOverlay);
        finish(true);
      };

      setupActivateBtn.addEventListener("click", activate, { signal });
      setupGroqKey.addEventListener(
        "keydown",
        (e) => {
          if (e.key === "Enter") activate();
        },
        { signal }
      );
      wireInputClear(
        [setupGroqKey, setupGroqProxy, setupElevenKey, setupElevenVoice],
        setupErr
      );
    }
  });
}

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
  } else if (next === States.LISTENING) {
    dotExtra = "bg-indigo-400 text-indigo-400";
  } else {
    dotExtra = "bg-slate-500 text-slate-500";
  }
  pulseDotEl.className = dotBase + dotExtra;

  const map = {
    [States.STANDBY]: "Standby",
    [States.LISTENING]: "Wake phrase",
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
  } else if (next === States.LISTENING) {
    hintTextEl.textContent =
      "Voice wake enabled — say “wake up jarvis” to activate conversation mode.";
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

function resetSessionFlags() {
  lastUtteranceFp = "";
  lastUtteranceTs = 0;
  wakeHandshakePending = false;
  exchangeLock = false;
}

async function teardownSession() {
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

  subtitleEl.textContent = "Microphone online. Say “wake up jarvis” when ready.";
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

/**
 * Router for speech aggregator.
 */
function handleSpeechRollup({ fullPhrase, deltaFinalsJoined }) {
  if (appState === States.LISTENING) {
    const phrase = `${fullPhrase}`.trim();
    const wakeUpJarvis = /\bwake\s*(up)?\s*jarvis\b/i.test(phrase);
    if (wakeUpJarvis || (phrase.length && WAKE_PHRASE_REGEX.test(phrase))) {
      void completeWakeHandshake();
    }
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
    speechNoteEl.textContent = "";

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
    const detail =
      error instanceof Error ? error.message : String(error);
    const clipped =
      detail.length > 300 ? `${detail.slice(0, 297)}...` : detail;
    speechNoteEl.textContent = clipped;
    subtitleEl.textContent =
      "Groq request failed — details in the small note under the status pill.";
    try {
      await jarvisVoice(
        "My apologies Sir — I lost contact with HQ networks. Shall we retry once circuits settle?",
        { priority: true }
      );
    } catch {
      await speak(
        "Groq request failed, Sir. Check the note on screen or the browser console."
      );
    }
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
  chatTurns = [];
  lastUtteranceFp = "";

  BUTTON_IDS.forEach((id) => {
    buttonOn[id] = false;
  });
  refreshButtonsUi();

  setState(States.LISTENING);
  subtitleEl.textContent =
    "Standing by for voice wake command. Say “wake up jarvis” when you are ready, Sir.";
  try {
    recognition.restartFresh();
  } catch {
    /**/
  }
}

async function completeWakeHandshake() {
  if (wakeHandshakePending) return;
  if (appState !== States.LISTENING) return;
  wakeHandshakePending = true;

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
    await waitForKeysUi({ force: false });
    await initialiseAudioStack();
    recognition.restartFresh();

    speechNoteEl.textContent =
      "Credentials loaded locally. Say “wake up jarvis” to begin.";
    setState(States.LISTENING);
    startBtn.textContent = "Suspend Jarvis mic";
    startBtn.onclick = async () => {
      await teardownSession();
      setState(States.STANDBY);
      subtitleEl.textContent =
        "Press Start to resume — then say “wake up jarvis” to activate conversational relay governance.";
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

configBtn?.addEventListener("click", async () => {
  if (appState === States.SPEAKING) return;
  const saved = await waitForKeysUi({ force: true });
  speechNoteEl.textContent = saved
    ? "Keys & voice updated locally."
    : "No changes saved.";
  subtitleEl.textContent = "Say “wake up jarvis” again if you were mid-session, Sir.";
});
