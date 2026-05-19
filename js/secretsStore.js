import credDefaults from "./credentials.js";

const LS_KEYS = {
  groqApiKey: "jarvis_groq_api_key",
  groqModel: "jarvis_groq_model",
  elevenLabsApiKey: "jarvis_elevenlabs_api_key",
  elevenLabsVoiceId: "jarvis_elevenlabs_voice_id",
  elevenLabsModelId: "jarvis_elevenlabs_model_id",
  groqProxyUrl: "jarvis_groq_proxy_url",
  elevenLabsProxyUrl: "jarvis_elevenlabs_proxy_url",
};

/** @param {Record<string,string>} ex */
function hasGroqConfigured(ex) {
  return Boolean(ex.groqApiKey?.trim()) || Boolean(ex.groqProxyUrl?.trim());
}

/** Groq (API key or proxy) is required once; ElevenLabs is optional (browser TTS otherwise). */
function setupComplete(surface) {
  return hasGroqConfigured(surface);
}

/** Same merge order as `resolveCredentials` in `aiService.js` (no circular import). */
export function getMergedSecretsSurface() {
  const w =
    typeof window !== "undefined" && window.JARVIS_CONFIG
      ? /** @type {Record<string,string>} */ (window.JARVIS_CONFIG)
      : {};
  const local = loadSecretsFromLocalStorage();
  return {
    groqApiKey: w.groqApiKey ?? local.groqApiKey ?? credDefaults.groqApiKey ?? "",
    groqProxyUrl:
      w.groqProxyUrl ?? local.groqProxyUrl ?? credDefaults.groqProxyUrl ?? "",
    elevenLabsApiKey:
      w.elevenLabsApiKey ??
      local.elevenLabsApiKey ??
      credDefaults.elevenLabsApiKey ??
      "",
    elevenLabsVoiceId:
      w.elevenLabsVoiceId ??
      local.elevenLabsVoiceId ??
      credDefaults.elevenLabsVoiceId ??
      "",
    elevenLabsProxyUrl:
      w.elevenLabsProxyUrl ??
      local.elevenLabsProxyUrl ??
      credDefaults.elevenLabsProxyUrl ??
      "",
  };
}

/**
 * @returns {{
 *   groqApiKey?: string,
 *   groqModel?: string,
 *   elevenLabsApiKey?: string,
 *   elevenLabsVoiceId?: string,
 *   elevenLabsModelId?: string,
 *   groqProxyUrl?: string,
 *   elevenLabsProxyUrl?: string
 * }}
 */
export function loadSecretsFromLocalStorage() {
  const raw = {
    groqApiKey:
      localStorage.getItem(LS_KEYS.groqApiKey) ??
      localStorage.getItem("jarvis_groq_key") ??
      "",
    groqModel: localStorage.getItem(LS_KEYS.groqModel) ?? "",
    elevenLabsApiKey:
      localStorage.getItem(LS_KEYS.elevenLabsApiKey) ?? "",
    elevenLabsVoiceId:
      localStorage.getItem(LS_KEYS.elevenLabsVoiceId) ?? "",
    elevenLabsModelId:
      localStorage.getItem(LS_KEYS.elevenLabsModelId) ?? "",
    groqProxyUrl: localStorage.getItem(LS_KEYS.groqProxyUrl) ?? "",
    elevenLabsProxyUrl:
      localStorage.getItem(LS_KEYS.elevenLabsProxyUrl) ?? "",
  };

  return raw;
}

/**
 * Saves non-empty values only.
 * @param {{
 *   groqApiKey?: string,
 *   groqModel?: string,
 *   elevenLabsApiKey?: string,
 *   elevenLabsVoiceId?: string,
 *   elevenLabsModelId?: string,
 *   groqProxyUrl?: string,
 *   elevenLabsProxyUrl?: string
 * }} secrets
 */
export function saveSecretsToLocalStorage(secrets) {
  /** @type {Record<string,string>} */
  const clean = {};

  Object.entries(LS_KEYS).forEach(([k, lsKey]) => {
    const v = /** @type {unknown} */ (secrets[k]);
    if (typeof v !== "string") return;
    const trimmed = v.trim();
    if (!trimmed) return;
    clean[k] = trimmed;
  });

  Object.entries(clean).forEach(([k, v]) => {
    localStorage.setItem(LS_KEYS[k], v);
  });
}

/** @returns {boolean} */
export function isGroqConfiguredMerged() {
  return setupComplete(getMergedSecretsSurface());
}

