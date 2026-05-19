/* =============================================
   JARVIS — CORE SYSTEM JS
   ============================================= */

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
  document.getElementById('saveStatus').textContent = 'CONFIGURATION SAVED';
  setTimeout(() => document.getElementById('saveStatus').textContent = '', 2000);
}

let systemOnline = false;
let isListening = false;
let isSpeaking = false;
let isProcessing = false;
let recognition = null;
let speechSynth = window.speechSynthesis;
let chatHistory = [];
let currentTab = 'chat';

function updateClock() {
  const now = new Date();
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const date = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const mc = document.getElementById('mainClock');
  const sc = document.getElementById('sleepClock');
  if (mc) mc.innerHTML = time + '<br><span style="font-size:9px;letter-spacing:1px;">' + date + '</span>';
  if (sc) sc.textContent = time;
}
setInterval(updateClock, 1000);
updateClock();

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
  r.onstart = function() {
    isListening = true;
    if (!systemOnline) {
      document.getElementById('micStatus').textContent = 'MICROPHONE ACTIVE — LISTENING FOR WAKE WORD';
    }
    updateVoiceUI();
  };
  r.onresult = function(event) {
    var interim = '';
    var final = '';
    for (var i = event.resultIndex; i < event.results.length; i++) {
      var t = event.results[i][0].transcript;
      if (event.results[i].isFinal) final += t;
      else interim += t;
    }
    var display = (final || interim).trim();
    if (display) {
      var box = document.getElementById('transcriptBox');
      if (box) box.textContent = display;
    }
    if (!systemOnline && final) checkWakeWord(final.toLowerCase());
    else if (systemOnline && final && !isProcessing && !isSpeaking) handleVoiceCommand(final.trim());
  };
  r.onerror = function(e) {
    if (e.error === 'not-allowed') {
      document.getElementById('micStatus').textContent = 'MIC DENIED — ALLOW MICROPHONE IN BROWSER';
      return;
    }
    setTimeout(function() { restartRecognition(); }, 1000);
  };
  r.onend = function() {
    isListening = false;
    updateVoiceUI();
    if (!isSpeaking) setTimeout(function() { restartRecognition(); }, 300);
  };
  return r;
}

function restartRecognition() {
  if (recognition) { try { recognition.start(); } catch(e) {} }
}

function startListening() {
  if (!recognition) recognition = initRecognition();
  if (recognition) { try { recognition.start(); } catch(e) {} }
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
  var toggle = document.getElementById('voiceToggle');
  var label = document.getElementById('voiceLabel');
  var sub = document.getElementById('voiceSub');
  var wave = document.getElementById('voiceWave');
  var badge = document.getElementById('voiceInBadge');
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

function checkWakeWord(text) {
  for (var i = 0; i < CONFIG.wakeWords.length; i++) {
    if (text.includes(CONFIG.wakeWords[i])) { bootSystem(); return; }
  }
}

function bootSystem() {
  if (systemOnline) return;
  systemOnline = true;
  var sleep = document.getElementById('sleepScreen');
  var main = document.getElementById('mainInterface');
  sleep.classList.add('fade-out');
  setTimeout(function() {
    sleep.style.display = 'none';
    main.classList.remove('hidden');
    setTimeout(function() { main.classList.add('visible'); }, 50);
  }, 1000);
  setTimeout(function() {
    runBootSequence();
    startListening();
    populateMetrics();
  }, 1200);
}

function runBootSequence() {
  var chat = document.getElementById('chatHistory');
  chat.innerHTML = '';
  var lines = [
    '> INITIALIZING J.A.R.V.I.S. CORE SYSTEMS...',
    '> LOADING NEURAL NETWORK ARCHITECTURE...',
    '> VOICE SYNTHESIS MODULE: READY',
    '> SPEECH RECOGNITION: ACTIVE',
    '> GROQ AI CORE: CONNECTED',
    '> ALL SYSTEMS NOMINAL.'
  ];
  lines.forEach(function(line, i) {
    setTimeout(function() {
      var el = document.createElement('div');
      el.className = 'boot-line';
      el.textContent = line;
      chat.appendChild(el);
      chat.scrollTop = chat.scrollHeight;
      if (i === lines.length - 1) setTimeout(function() { greetUser(); }, 400);
    }, i * 300);
  });
}

function greetUser() {
  var hour = new Date().getHours();
  var greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  var msg = greeting + ', ' + CONFIG.userName + '. All J.A.R.V.I.S. systems are fully operational. I have run an initial scan. Shall I run through your complete daily briefing, or is there something specific you would like to address?';
  chatHistory = [];
  chatHistory.push({ role: 'assistant', content: msg });
  addMessage('JARVIS', msg);
  speak(msg);
}

function handleVoiceCommand(text) {
  if (!text || text.length < 2) return;
  document.getElementById('chatInput').value = text;
  document.getElementById('transcriptBox').textContent = '';
  sendMessage();
}

function getSystemPrompt() {
  return 'You are JARVIS, a sophisticated AI assistant. Be concise, intelligent, and slightly formal. Address the user as ' + CONFIG.userName + ' occasionally. Current date/time: ' + new Date().toLocaleString() + '. You can assist with general tasks, email drafting, scheduling, research, and daily planning.';
}

function sendMessage() {
  var input = document.getElementById('chatInput');
  var text = input.value.trim();
  if (!text || isProcessing) return;
  input.value = '';
  addMessage('YOU', text);
  chatHistory.push({ role: 'user', content: text });
  isProcessing = true;
  document.getElementById('sendBtn').disabled = true;
  showTyping();
  callGroq(chatHistory).then(function(response) {
    removeTyping();
    addMessage('JARVIS', response);
    chatHistory.push({ role: 'assistant', content: response });
    speak(response);
  }).catch(function(e) {
    removeTyping();
    var errMsg = CONFIG.groqKey
      ? 'I am experiencing a connectivity issue ' + CONFIG.userName + '. Error: ' + e.message
      : 'API key not configured ' + CONFIG.userName + '. Please open settings and enter your Groq API key.';
    addMessage('JARVIS', errMsg);
    speak(errMsg);
  }).finally(function() {
    isProcessing = false;
    document.getElementById('sendBtn').disabled = false;
  });
}

function callGroq(messages) {
  if (!CONFIG.groqKey) return Promise.reject(new Error('No Groq API key'));
  var body = {
    model: CONFIG.groqModel,
    max_tokens: 1024,
    messages: [{ role: 'system', content: getSystemPrompt() }].concat(messages.slice(-30))
  };
  return fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + CONFIG.groqKey
    },
    body: JSON.stringify(body)
  }).then(function(res) {
    if (!res.ok) return res.json().then(function(err) { throw new Error(err.error ? err.error.message : 'HTTP ' + res.status); });
    return res.json();
  }).then(function(data) {
    return data.choices[0].message.content;
  });
}

function askJarvisAbout(prompt) {
  switchTab('chat');
  document.getElementById('chatInput').value = prompt;
  sendMessage();
}

function addMessage(sender, text) {
  var chat = document.getElementById('chatHistory');
  var wrap = document.createElement('div');
  wrap.className = 'msg-wrap ' + (sender === 'YOU' ? 'user' : 'jarvis');
  var label = document.createElement('div');
  label.className = 'msg-label';
  label.textContent = sender === 'YOU' ? 'YOU' : 'J.A.R.V.I.S.';
  var bubble = document.createElement('div');
  bubble.className = 'msg-bubble ' + (sender === 'YOU' ? 'user' : 'jarvis');
  bubble.innerHTML = markdownToHTML(text);
  wrap.appendChild(label);
  wrap.appendChild(bubble);
  chat.appendChild(wrap);
  chat.scrollTop = chat.scrollHeight;
}

function showTyping() {
  var chat = document.getElementById('chatHistory');
  var el = document.createElement('div');
  el.id = 'typingBubble';
  el.className = 'msg-wrap jarvis';
  el.innerHTML = '<div class="msg-label">J.A.R.V.I.S.</div><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
}

function removeTyping() {
  var el = document.getElementById('typingBubble');
  if (el) el.remove();
}

function markdownToHTML(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^- (.*$)/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<)(.+)/gm, function(m) { return m.startsWith('<') ? m : '<p>' + m + '</p>'; })
    .replace(/<p><\/p>/g, '');
}

function speak(text) {
  var cleanText = text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/<[^>]+>/g, '').replace(/\n+/g, '. ');
  if (cleanText.length < 2) return;
  isSpeaking = true;
  document.getElementById('speakingIndicator').classList.remove('hidden');
  document.getElementById('voiceOutBadge').textContent = 'SPEAKING';
  document.getElementById('voiceOutBadge').className = 'badge blue';
  if (recognition) { try { recognition.stop(); } catch(e) {} }

  function done() {
    isSpeaking = false;
    document.getElementById('speakingIndicator').classList.add('hidden');
    document.getElementById('voiceOutBadge').textContent = 'READY';
    document.getElementById('voiceOutBadge').className = 'badge green';
    setTimeout(function() { restartRecognition(); }, 400);
  }

  if (CONFIG.elevenLabsKey) {
    fetch('https://api.elevenlabs.io/v1/text-to-speech/' + CONFIG.voiceId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': CONFIG.elevenLabsKey },
      body: JSON.stringify({ text: cleanText.substring(0, 500), model_id: 'eleven_monolingual_v1', voice_settings: { stability: 0.5, similarity_boost: 0.8 } })
    }).then(function(res) {
      return res.blob();
    }).then(function(blob) {
      var url = URL.createObjectURL(blob);
      var audio = new Audio(url);
      audio.onended = function() { URL.revokeObjectURL(url); done(); };
      audio.onerror = done;
      audio.play();
    }).catch(function() { speakBrowser(cleanText, done); });
  } else {
    speakBrowser(cleanText, done);
  }
}

function speakBrowser(text, done) {
  speechSynth.cancel();
  var utt = new SpeechSynthesisUtterance(text.substring(0, 300));
  utt.rate = 0.95;
  utt.pitch = 0.85;
  utt.volume = 1;
  var voices = speechSynth.getVoices();
  var preferred = voices.find(function(v) {
    return v.name.includes('Google UK English Male') || v.name.includes('Daniel') || v.name.includes('Microsoft David');
  });
  if (preferred) utt.voice = preferred;
  utt.onend = done;
  utt.onerror = done;
  speechSynth.speak(utt);
}

function goToSleep() {
  systemOnline = false;
  var sleep = document.getElementById('sleepScreen');
  var main = document.getElementById('mainInterface');
  main.classList.remove('visible');
  setTimeout(function() {
    main.classList.add('hidden');
    sleep.style.display = 'flex';
    sleep.classList.remove('fade-out');
    sleep.style.opacity = '1';
  }, 800);
  document.getElementById('micStatus').textContent = 'LISTENING FOR WAKE WORD...';
  chatHistory = [];
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.nav-tab').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.mod-btn').forEach(function(el) { el.classList.remove('active'); });
  var tabEl = document.getElementById('tab-' + tab);
  if (tabEl) tabEl.classList.add('active');
  var navTab = document.querySelector('[data-tab="' + tab + '"]');
  if (navTab) navTab.classList.add('active');
  var modMap = { chat: 'modChat', email: 'modEmail', schedule: 'modSchedule', brief: 'modBrief' };
  var modEl = document.getElementById(modMap[tab]);
  if (modEl) modEl.classList.add('active');
}

function toggleSettings() {
  document.getElementById('settingsOverlay').classList.toggle('hidden');
}

function populateMetrics() {
  setTimeout(function() {
    animateMetric('mv-emails', 14, 'mf-emails', 70);
    animateMetric('mv-meetings', 3, 'mf-meetings', 45);
    animateMetric('mv-tasks', 7, 'mf-tasks', 55);
    document.getElementById('alertList').innerHTML =
      '<div class="alert-item">14 unread emails — 2 urgent</div>' +
      '<div class="alert-item ok">Calendar synced — 3 meetings</div>' +
      '<div class="alert-item">7 tasks awaiting review</div>';
  }, 800);
}

function animateMetric(valId, target, barId, pct) {
  var count = 0;
  var interval = setInterval(function() {
    count++;
    document.getElementById(valId).textContent = count;
    if (count >= target) clearInterval(interval);
  }, 80);
  setTimeout(function() {
    document.getElementById(barId).style.width = pct + '%';
  }, 200);
}

window.addEventListener('DOMContentLoaded', function() {
  loadConfig();
  document.getElementById('micStatus').textContent = 'REQUESTING MICROPHONE ACCESS...';
  recognition = initRecognition();
  if (recognition) {
    startListening();
    document.getElementById('micStatus').textContent = 'MICROPHONE ACTIVE — LISTENING FOR WAKE UP OR JARVIS';
  }
  document.getElementById('sleepScreen').addEventListener('click', function() {
    if (!systemOnline) bootSystem();
  });
});