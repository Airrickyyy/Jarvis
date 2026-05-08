/**
 * API keys live in plain JS so this static demo can load without build tooling.
 *
 * ⚠ Prefer pasting overrides at runtime (dev only): set `window.JARVIS_CONFIG`.
 * ⚠ Putting real keys here (or deploying them to GitHub Pages) exposes credentials in the bundle.
 *
 * Recommended for production: a tiny HTTPS proxy (same origin) adds auth + hides keys.
 */

export default {
  /** Groq API key (starts with gsks_…) */
  groqApiKey: "",
  groqModel: "llama-3.3-70b-versatile",
  /** ElevenLabs */
  elevenLabsApiKey: "",
  elevenLabsVoiceId: "",
  elevenLabsModelId: "eleven_flash_v2_5",
  /** Optional HTTPS proxy endpoints on YOUR origin — avoid CORS + hide keys */
  groqProxyUrl: "",
  elevenLabsProxyUrl: "",
};
