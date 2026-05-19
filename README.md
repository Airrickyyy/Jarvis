# J.A.R.V.I.S. — Setup Guide

## Quick Start

1. Open `index.html` in Chrome or Edge (required for voice)
2. Click the ⚙ settings icon and enter your API key(s)
3. Allow microphone access when prompted
4. Say **"Wake up"** or **"Jarvis"** to boot the system

---

## API Keys

### Anthropic API Key (Required for AI)
- Get yours at: https://console.anthropic.com
- Enter it in Settings → ANTHROPIC API KEY
- Without this, JARVIS can't answer questions

### ElevenLabs API Key (Optional — Better Voice)
- Get yours at: https://elevenlabs.io
- Enter it in Settings → ELEVENLABS API KEY
- Without this, JARVIS uses your browser's built-in voice (sounds more robotic)
- Recommended Voice ID: `pNInz6obpgDQGcFmaJgB` (Adam) or find others in your ElevenLabs dashboard

---

## Voice Commands

| Say | What Happens |
|-----|-------------|
| "Wake up" / "Jarvis" | Boots the system from sleep |
| Anything else | JARVIS processes and responds |
| Any question | Full AI response with voice |

Voice is always listening after wake. Anything you say gets sent to JARVIS.

---

## Hosting

### Local (simplest)
Just open `index.html` directly in Chrome/Edge.

### GitHub Pages (free hosting)
1. Create a GitHub repo
2. Upload all files
3. Go to Settings → Pages → Deploy from main branch
4. Your JARVIS will be live at `https://yourname.github.io/jarvis`

### Netlify (free, drag & drop)
1. Go to netlify.com
2. Drag the entire `jarvis` folder onto the deploy area
3. Done — live in seconds

> **Note on API keys when hosting:** If you deploy publicly, don't hardcode your API key. Use the Settings panel — keys are stored in your browser's localStorage and never sent anywhere except the API directly.

---

## Customization

Edit `js/jarvis.js` → `CONFIG` object at the top:
- `wakeWords`: Add/change wake phrases
- `userName`: How JARVIS addresses you

Edit `css/style.css` to change colors:
- `--blue`: Main accent color (default: cyan)
- `--green`: Success/active color
- `--bg`: Background color

---

## Coming Soon (Next Steps)
- Gmail integration (Google OAuth)
- Google Calendar sync
- Daily briefing with real data
- Weather module
- News briefing
