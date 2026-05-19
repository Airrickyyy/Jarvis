/* =============================================
   JARVIS — CORE SYSTEM JS
   ============================================= */

// ── CONFIG ──────────────────────────────────────────────────────────
let CONFIG = {
  groqKey: '',
  groqModel: 'llama-3.3-70b-versatile',
  elevenLabsKey: '',
  voiceId: 'pNInz6obpgDQGcFmaJgB',
  userName: 'sir',
  wakeWords: ['wake up', 'jarvis', 'hey jarvis', 'wake', 'start'],
};

function loadConfig() {
  const saved = localStorage.getItem('jarvis_config');
  if (saved) Object.assign(CONFIG, JSON.parse(saved));
  document.getElementById('apiKeyInput').value = CONFIG.groqKey;
  document.getElementById('groqModelInput').value = CONFIG.groqModel;
  document.getElementById('elevenLabsInput').value = CONFIG.elevenLabsKey;
  document.getElementById('voiceIdInput').value = CONFIG.voiceId;
  document.getElementById('userNameInput').value = CONFIG.userName;
  document.getElementById('wakeWordsInput').value = CONFIG.wakeWords.join(', ');
}

function saveSettings() {
  CONFIG.groqKey = document.getElementById('apiKeyInput').value.trim();
  CONFIG.groqModel = document.getElementById('groqModelInput').value.trim() || 'llama-3.3-70b-versatile';
  CONFIG.elevenLabsKey = document.getElementById('elevenLabsInput').value.trim();
  CONFIG.voiceId = document.getElementById('voiceIdInput').value.trim() || 'pNInz6obpgDQGcFmaJgB';
  CONFIG.userName = document.getElementById('userNameInput').value.trim() || 'sir';
  CONFIG.wakeWords = document.getElementById('wakeWordsInput').value
    .split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
  localStorage.setItem('jarvis_config', JSON.stringify(CONFIG));
  document.getElementById('saveStatus').textContent = '✓ CONFIGURATION SAVED';
  setTimeout(() => document.getElementById('saveStatus').textContent = '', 2000);
}

// ── STATE ────────────────────────────────────────────────────────────
let systemOnline = false;
let isListening = false;
let isSpeaking = false;
let isProcessing = false;
let recognition = null;
let speechSynth = window.speechSynthesis;
let chatHistory = [];
let currentTab = 'chat';

// ── CLOCK ────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const date = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const mc = document.getElementById('mainClock');
  const sc = document.getElementById('sleepClock');
  if (mc) mc.innerHTML = `${time}<br><span style="font-size:9px;letter-spacing:1px;">${date}</span>`;
  if (sc) sc.textContent = time;
}
setInterval(updateClock, 1000);
updateClock();

// ── SPEECH RECOGNITION ───────────────────────────────────────────────
function initRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    document.getElementById('micStatus').textContent = 'USE CHROME OR EDGE FOR VOICE';
    return null;
  }

  const r = new SpeechRecognition();
  r.continuous = true;
  r.interimResults = true;
  r.lang = 'en-US';
  r.maxAlternatives = 3;

  r.onstart = () => {
    isListening = true;
    if (!systemOnline) {
      document.getElementById('micStatus').textContent = '● MICROPHONE ACTIVE — LISTENING FOR WAKE WORD';
    }
    updateVoiceUI();
  };

  r.onresult = (event) => {
    let interim = '';
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) final += t;
      else interim += t;
    }
    const display = (final || interim).trim();
    if (display) {
      const box = document.getElementById('transcriptBox');
      if (box) box.textContent = display;
    }
    if (!systemOnline && final) checkWakeWord(final.toLowerCase());
    else if (systemOnline && final && !isProcessing && !isSpeaking) handleVoiceCommand(final.trim());
  };

  r.onerror = (e) => {
    if (e.error === 'not-allowed') {
      document.getElementById('micStatus').textContent = 'MIC DENIED — ALLOW MICROPHONE IN BROWSER';
      return;
    }
    setTimeout(() => restartRecognition(), 1000);
  };

  r.onend = () => {
    isListening = false;
    updateVoiceUI();
    if (!isSpeaking) setTimeout(() => restartRecognition(), 300);
  };

  return r;
}

function restartRecognition() {
  if (recognition) try { recognition.start(); } catch (e) {}
}

function startListening() {
  if (!recognition) recognition = initRecognition();
  if (recognition) try { recognition.start(); } catch (e) {}
}

function toggleListening() {
  if (isListening) {
    if (recognition) recognition.stop();
    document.getElementById('voiceLabel').textContent = 'PAUSED';
    document.getElementById('voiceSub').textContent = 'Click to resume';
    document.getElementById('voiceToggle').classList.remove('active');
    document.getElementById('voiceToggle').classList.add('paused');
    document.getElementById('voiceInBadge').textContent = 'PAUSED';
    document.getElementById('voiceInBadge').className = 'badge amber';
  } else {
    startListening();
  }
}

function updateVoiceUI() {
  const toggle = document.getElementById('voiceToggle');
  const label = document.getElementById('voiceLabel');
  const sub = document.getElementById('voiceSub');
  const wave = document.getElementById('voiceWave');
  const badge = document.getElementById('voiceInBadge');
  if (!toggle) return;
  if (isListening) {
    toggle.classList.add('active');
    toggle.classList.remove('paused');
    label.textContent = isSpeaking ? 'JARVIS SPEAKING' : 'LISTENING';
    sub.textContent = isSpeaking ? 'Processing paused' : 'Say anything...';
    wave.classList.toggle('active', !isSpeaking);
    badge.textContent = 'LISTENING';
    badge.className = 'badge green';
  }
}

// ── WAKE WORD ────────────────────────────────────────────────────────
function checkWakeWord(text) {
  for (const word of CONFIG.wakeWords) {
    if (text.includes(word)) { bootSystem(); return; }
  }
}

// ── BOOT ─────────────────────────────────────────────────────────────
function bootSystem() {
  if (systemOnline) return;
  systemOnline = true;

  const sleep = document.getElementById('sleepScreen');
  const main = document.getElementById('mainInterface');

  sleep.classList.add('fade-out');
  setTimeout(() => {
    sleep.style.display = 'none';
    main.classList.remove('hidden');
    setTimeout(() => main.classList.add('visible'), 50);
  }, 1000);

  setTimeout(() => {
    runBootSequence();
    startListening();
    populateMetrics();
  }, 1200);
}

function runBootSequence() {
  const chat = document.getElementById('chatHistory');
  chat.innerHTML = '';

const lines = [
    '> INITIALIZING J.A.R.V.I.S. CORE SYSTEMS...',
    '> LOADING NEURAL NETWORK ARCHITECTURE...',
    '> VOICE SYNTHESIS MODULE: READY',
    '> SPEECH RECOGNITION: ACTIVE',
    '> GROQ AI CORE: CONNECTED',
    '> ALL SYSTEMS NOMINAL.',
  ];