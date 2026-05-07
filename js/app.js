import {
  CLAP_AUDIO_THRESHOLD_BASE,
  WAKE_PHRASE_REGEX,
  WAKE_PHRASE_WINDOW_MS,
} from "./constants.js";
import { createClapDetector } from "./clapDetector.js";
import {
  parseButtonCommand,
  formatConfirmation,
} from "./commandParser.js";
import {
  speak,
  createRecognitionSession,
} from "./voice.js";

/** UI / engine states */
const States = /** @type {const} */ ({
  STANDBY: "standby",
  LISTENING: "listening",
  ARMED_WAKEUP: "armed_wakeup",
  SPEAKING: "speaking",
  ACTIVE: "active_commands",
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

/** @type {Record<ButtonId, boolean>} */
const buttonOn = Object.fromEntries(
  BUTTON_IDS.map((id) => [id, false])
);

/** @type { keyof typeof States } */
let appState = States.STANDBY;

/** Prevents overlapping wake completions if transcripts repeat. */
let wakeHandshakePending = false;

let audioContext = null;
/** @type {MediaStream | null} */
let mediaStream = null;
let clapper = createClapDetector({ onDoubleClap: handleDoubleClap });

let armTimerId = null;
/** @type {number} */
let armDeadlineTs = 0;

/** Dedupe repeated parses of the same final chunk */
/** @type {string} */
let lastCommandFingerprint = "";
let lastCommandTime = 0;

function setState(next) {
  appState = next;

  const dotBase =
    "h-2 w-2 shrink-0 rounded-full shadow-[0_0_14px_currentColor] transition-colors duration-300 ";
  let dotExtra = "";
  if (next === States.ACTIVE) {
    dotExtra = "bg-emerald-400 text-emerald-400";
  } else if (next === States.ARMED_WAKEUP) {
    dotExtra = "bg-indigo-400 text-indigo-400";
  } else if (next === States.SPEAKING) {
    dotExtra = "bg-amber-400 text-amber-400";
  } else if (next === States.LISTENING) {
    dotExtra = "bg-slate-400 text-slate-400";
  } else {
    dotExtra = "bg-slate-500 text-slate-500";
  }
  pulseDotEl.className = dotBase + dotExtra;

  const map = {
    [States.STANDBY]: "Standby",
    [States.LISTENING]: "Listening",
    [States.ARMED_WAKEUP]: "Wake phrase",
    [States.SPEAKING]: "Initialising…",
    [States.ACTIVE]: "Jarvis Active",
  };
  stateLabelEl.textContent = map[next];

  if (next === States.ACTIVE) {
    hintTextEl.textContent =
      `Voice — try “Enable button A”, “Turn on B and D”, “Activate all buttons”. Threshold base ≈ ${CLAP_AUDIO_THRESHOLD_BASE}.`;
  } else if (next === States.ARMED_WAKEUP) {
    hintTextEl.textContent = `Say clearly: “wake up”. Window ${Math.round(
      WAKE_PHRASE_WINDOW_MS / 1000
    )}s — double-clap resets this timer.`;
  } else if (next === States.SPEAKING) {
    hintTextEl.textContent =
      "Speech recognition muted briefly while briefing audio plays.";
  } else if (next === States.LISTENING) {
    hintTextEl.textContent = `Listening for double-clap handshake (Audio API, threshold base ${CLAP_AUDIO_THRESHOLD_BASE}).`;
  } else {
    hintTextEl.textContent =
      "Mic offline. Start the system when you are ready to arm audio.";
  }
}

function clearArmTimer() {
  if (armTimerId !== null) {
    clearTimeout(armTimerId);
    armTimerId = null;
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
    el.tabIndex = -1;
  });
}

async function teardownAudio() {
  clearArmTimer();
  clapper.stop();
  recognition.stop();

  if (audioContext) {
    await audioContext.close();
    audioContext = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }

  resetEngineFlags();
}

function resetEngineFlags() {
  armDeadlineTs = 0;
  lastCommandFingerprint = "";
  lastCommandTime = 0;
  wakeHandshakePending = false;
}

async function initialiseAudioStack() {
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: false,
  });

  audioContext = new AudioContext();
  await audioContext.resume();
  clapper.start(audioContext, mediaStream);

  subtitleEl.textContent =
    "System live. Listening for handshake claps followed by wake phrase.";
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
  if (appState === States.SPEAKING || appState === States.ACTIVE) return;

  recognition.restartFresh();
  clearArmTimer();
  armDeadlineTs = Date.now() + WAKE_PHRASE_WINDOW_MS;
  armTimerId = window.setTimeout(() => {
    if (appState !== States.ARMED_WAKEUP) return;
    setState(States.LISTENING);
    subtitleEl.textContent =
      "Listening again. Wake window expired — double-clap once more.";
  }, WAKE_PHRASE_WINDOW_MS);

  setState(States.ARMED_WAKEUP);
  subtitleEl.textContent =
    "Wake sequence armed. Say distinctly: “wake up”.";
}

/**
 * Handles wake detection on rolling phrase plus command deltas when active.
 * @param {{ fullPhrase: string, deltaFinalsJoined: string }} args
 */
function handleSpeechRollup({ fullPhrase, deltaFinalsJoined }) {
  if (appState === States.ARMED_WAKEUP) {
    if (Date.now() > armDeadlineTs) return;
    if (!WAKE_PHRASE_REGEX.test(fullPhrase)) return;
    void completeWakeHandshake();
    return;
  }

  if (appState !== States.ACTIVE) return;

  const chunk = deltaFinalsJoined.trim();
  if (!chunk) return;

  const nowTs = Date.now();
  const fp = `${chunk.toLowerCase()}`;
  if (fp === lastCommandFingerprint && nowTs - lastCommandTime < 1200) {
    return;
  }
  lastCommandFingerprint = fp;
  lastCommandTime = nowTs;

  const parsed = parseButtonCommand(chunk);
  if (!parsed) return;

  const snapshotBefore = { ...buttonOn };
  applyParseResult(parsed);

  const sentence = formatConfirmation(snapshotBefore, { ...buttonOn }, parsed);

  subtitleEl.textContent = `Heard command: "${chunk}".`;
  recognition.stop();

  speak(sentence).finally(() => {
    recognition.restartFresh();
  });
}

function applyParseResult(parsed) {
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

async function completeWakeHandshake() {
  if (wakeHandshakePending) return;
  if (appState !== States.ARMED_WAKEUP) return;
  wakeHandshakePending = true;
  clearArmTimer();
  setState(States.SPEAKING);
  recognition.stop();

  subtitleEl.textContent = "Wake credentials accepted. Bringing core online.";
  try {
    await speak("Good morning, Sir,");
    setState(States.ACTIVE);
    subtitleEl.textContent =
      "Operational. Voice relays armed — articulate button commands crisply.";
    recognition.restartFresh();
  } finally {
    wakeHandshakePending = false;
  }
}

async function bootstrapFromUserGesture() {
  if (!RecognitionCtorAvailable()) {
    speechNoteEl.textContent =
      "SpeechRecognition unsupported in this browser. Use Chrome desktop.";
    return;
  }

  if (!window.isSecureContext) {
    speechNoteEl.textContent =
      "Not a secure context — use http://127.0.0.1 via Serve-Local (.ps1 / .bat), not file://.";
    subtitleEl.textContent =
      "Run Serve-Local.ps1 (or .bat), then open the http://127.0.0.1 link it prints — not file:///…";
    insecureWarningEl?.removeAttribute("hidden");
    startBtn.disabled = false;
    return;
  }

  startBtn.disabled = true;
  startBtn.textContent = "Listening…";

  try {
    await initialiseAudioStack();
    recognition.start();
    setState(States.LISTENING);
    speechNoteEl.textContent = "Recognition engine ready.";
    hintTextEl.textContent =
      "Arming requires two brisk claps, then articulate “wake up”.";
    startBtn.textContent = "Stop Jarvis mic";
    startBtn.onclick = async () => {
      await teardownAudio();
      BUTTON_IDS.forEach((id) => {
        buttonOn[id] = false;
      });
      refreshButtonsUi();
      setState(States.STANDBY);
      subtitleEl.textContent =
        'Click “Start Jarvis mic”, allow audio, complete “double clap + wake up”.';
      startBtn.disabled = false;
      startBtn.textContent = "Start Jarvis mic";
      refreshButtonsUi();
      startBtn.onclick = bootstrapFromUserGesture;
    };
  } catch (error) {
    console.error(error);
    const code = /** @type {DOMException | Error} */ (error)?.name;
    if (!window.isSecureContext || code === "SecurityError") {
      subtitleEl.textContent =
        'Mic blocked — open this page over http://127.0.0.1 using Serve-Local, not file://.';
      speechNoteEl.textContent =
        "Use Serve-Local.ps1 / .bat, then allow mic on the localhost page.";
      insecureWarningEl?.removeAttribute("hidden");
    } else if (code === "NotAllowedError" || code === "PermissionDeniedError") {
      subtitleEl.textContent =
        'Browser denied microphone permission — unlock in the padlock/menu or site settings.';
      speechNoteEl.textContent =
        "Reset mic for this site under chrome://settings/content/microphone (or Edge equivalent).";
    } else if (code === "NotFoundError") {
      speechNoteEl.textContent = "No microphone device found.";
    } else {
      speechNoteEl.textContent = `Mic error: ${code || "unknown"} — try another browser or reboot audio.`;
    }
    startBtn.disabled = false;
    startBtn.textContent = "Retry Start";
  }
}

function RecognitionCtorAvailable() {
  return Boolean(
    window.SpeechRecognition || window.webkitSpeechRecognition
  );
}

if (!RecognitionCtorAvailable()) {
  speechNoteEl.textContent =
    "Requires SpeechRecognition API (desktop Chrome recommended).";
}

if (!window.isSecureContext) {
  insecureWarningEl?.removeAttribute("hidden");
  speechNoteEl.textContent =
    "Open via http://127.0.0.1 — see Serve-Local.ps1. file:// hides or blocks mic prompts.";
}

setState(States.STANDBY);

startBtn.addEventListener("click", bootstrapFromUserGesture);
