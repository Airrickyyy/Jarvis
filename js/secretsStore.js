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

/**
 * @param {string} g
 * @param {string} e
 * @param {string} v
 */
function formatSetupPromptDefault(g, e, v) {
  return [g, e, v].join("|");
}

/**
 * @param {string} line
 * @returns {{ groqApiKey: string, elevenLabsApiKey: string, elevenLabsVoiceId: string }}
 */
function parseSetupPipeLine(line) {
  const parts = `${line ?? ""}`.split("|").map((s) => s.trim());
  return {
    groqApiKey: parts[0] ?? "",
    elevenLabsApiKey: parts[1] ?? "",
    elevenLabsVoiceId: parts[2] ?? "",
  };
}

/** Same merge order as `resolveCredentials` in `aiService.js` (no circular import). */
function resolveSecretsSurface() {
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
    groqApiKey: localStorage.getItem(LS_KEYS.groqApiKey) ?? "",
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

/**
 * One dialog: Groq_key | ElevenLabs_key | Voice_ID (model uses repo default).
 * Groq is satisfied by api key or groqProxyUrl in LS / credentials / JARVIS_CONFIG.
 * ElevenLabs optional — leave key & voice empty to use British browser speech instead.
 *
 * @param {{ force?: boolean }} opts
 */
export async function ensureSecretsPrompt({ force } = {}) {
  const existing = loadSecretsFromLocalStorage();
  const surface = resolveSecretsSurface();

  if (!force && setupComplete(surface)) {
    return existing;
  }

  const def = formatSetupPromptDefault(
    surface.groqApiKey,
    surface.elevenLabsApiKey,
    surface.elevenLabsVoiceId
  );

  const label = force
    ? "Update keys — Groq_API_key | ElevenLabs_key | Voice_ID (edit, OK saves non-empty segments only):"
    : "Jarvis setup (one time) — paste: Groq_API_key | ElevenLabs_key | Voice_ID\nLeave ElevenLabs key & voice empty to use British browser voice only. Groq model stays the default from credentials.";

  const input = window.prompt(label, def);
  if (input === null) {
    return existing;
  }

  const parsed = parseSetupPipeLine(input);

  /** @type {Record<string,string>} */
  const updates = {};
  if (parsed.groqApiKey) updates.groqApiKey = parsed.groqApiKey;
  if (parsed.elevenLabsApiKey)
    updates.elevenLabsApiKey = parsed.elevenLabsApiKey;
  if (parsed.elevenLabsVoiceId)
    updates.elevenLabsVoiceId = parsed.elevenLabsVoiceId;

  saveSecretsToLocalStorage(updates);
  return loadSecretsFromLocalStorage();
}

