import credDefaults from "./credentials.js";
import { createGroqMessageList } from "./commandParser.js";
import { speak } from "./voice.js";

/**
 * @typedef {{
 *   groqApiKey: string,
 *   groqModel: string,
 *   elevenLabsApiKey: string,
 *   elevenLabsVoiceId: string,
 *   elevenLabsModelId: string,
 *   groqProxyUrl?: string,
 *   elevenLabsProxyUrl?: string,
 * }} ResolvedSecrets
 */

/** @returns {ResolvedSecrets} */
export function resolveCredentials() {
  const w =
    typeof window !== "undefined" && window.JARVIS_CONFIG
      ? /** @type {Record<string,string>} */ (window.JARVIS_CONFIG)
      : {};

  /** @type {ResolvedSecrets} */
  const merged = {
    groqApiKey: w.groqApiKey ?? credDefaults.groqApiKey ?? "",
    groqModel: w.groqModel ?? credDefaults.groqModel ?? "llama-3.3-70b-versatile",
    elevenLabsApiKey: w.elevenLabsApiKey ?? credDefaults.elevenLabsApiKey ?? "",
    elevenLabsVoiceId: w.elevenLabsVoiceId ?? credDefaults.elevenLabsVoiceId ?? "",
    elevenLabsModelId:
      w.elevenLabsModelId ?? credDefaults.elevenLabsModelId ?? "eleven_flash_v2_5",
    groqProxyUrl: w.groqProxyUrl ?? credDefaults.groqProxyUrl ?? "",
    elevenLabsProxyUrl:
      w.elevenLabsProxyUrl ?? credDefaults.elevenLabsProxyUrl ?? "",
  };
  return merged;
}

/** @typedef {{ role: 'user' | 'assistant' | 'system', content: string }} ChatTurn */

/** @typedef {{ stand_down?: boolean, all_buttons?: boolean | null, button_updates?: Partial<Record<string, boolean>>, reply?: string }} RelayJsonShape */

/** @typedef {{ standDown: boolean, relayPayload: RelayJsonShape, rawAssistant: string }} GroqRelayResult */

/**
 * @param {string} assistantText
 * @returns {{ ok: boolean, value?: RelayJsonShape, error?: string }}
 */
export function stripAndParseGroqRelayJson(assistantText) {
  let t = assistantText.trim();
  const fenceStart = /^```(?:json)?/i.exec(t);
  if (fenceStart && fenceStart.index === 0) {
    t = t.slice(fenceStart[0].length).trim();
    t = t.replace(/```$/i, "").trim();
  }
  try {
    const value = /** @type {RelayJsonShape} */ (JSON.parse(t));
    return { ok: true, value };
  } catch {
    return { ok: false, error: assistantText.slice(0, 600) };
  }
}

/**
 * @param {{
 *   userText: string,
 *   history: ChatTurn[],
 *   secrets: ResolvedSecrets,
 * }} args
 * @returns {Promise<GroqRelayResult>}
 */
export async function runGroqRelayTurn({ userText, history, secrets }) {
  if (!secrets.groqApiKey && !secrets.groqProxyUrl) {
    return {
      standDown: /\b(go to sleep|stand down)\b/i.test(userText),
      relayPayload: {
        reply:
          "I’m afraid I haven’t API credentials yet, Sir. Populate js/credentials.js or window.JARVIS_CONFIG.",
      },
      rawAssistant: "{}",
    };
  }

  const messages = [
    ...createGroqMessageList(history, userText),
  ];

  const url =
    secrets.groqProxyUrl ||
    "https://api.groq.com/openai/v1/chat/completions";

  const payload = /** @type {Record<string, unknown>} */ ({
    model: secrets.groqModel,
    messages,
    temperature: 0.35,
    response_format: { type: "json_object" },
  });

  /** @type {HeadersInit} */
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (secrets.groqApiKey) {
    /** @type {Record<string,string>} */
    const h = /** @type {Record<string,string>} */ (headers);
    h.Authorization = `Bearer ${secrets.groqApiKey}`;
  }

  let res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    mode: "cors",
  });

  /** Optional same-origin proxies may expect no Authorization header upstream */
  if (!res.ok && secrets.groqProxyUrl && res.status === 401 && secrets.groqApiKey) {
    const altHeaders = { "Content-Type": "application/json", Accept: "application/json" };
    res = await fetch(secrets.groqProxyUrl, {
      method: "POST",
      headers: altHeaders,
      body: JSON.stringify(payload),
      mode: "cors",
    });
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Groq ${res.status}: ${errBody.slice(0, 240)}`);
  }

  /** @type {{ choices?: Array<{ message?: { content?: string }} } }} */
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content?.trim?.() ?? "";
  const parsed = stripAndParseGroqRelayJson(content);

  let relayPayload;
  if (!parsed.ok) {
    relayPayload = {
      reply:
        parsed.error ||
        "I heard you, Sir, but I struggle to marshal that into relays. Shall we retry?",
      stand_down: false,
    };
  } else {
    relayPayload =
      parsed.value ??
      ({
        reply: "",
        stand_down: false,
      });
  }

  const standDown = Boolean(relayPayload.stand_down);
  return { standDown, relayPayload, rawAssistant: content };
}

/**
 * @param {{
 *   text: string,
 *   secrets: ResolvedSecrets,
 *   audioCtx: AudioContext,
 *   onSentenceStart?: (sentence: string) => void,
 * }} args
 */
export async function speakWithElevenLabsSentences({
  text,
  secrets,
  audioCtx,
  onSentenceStart,
}) {
  const clean = `${text ?? ""}`.trim();
  if (!clean.length) return;

  if (!secrets.elevenLabsApiKey || !secrets.elevenLabsVoiceId) {
    await audioCtx.resume();
    await speak(clean);
    return;
  }

  const sentences = chunkTextForSpeech(clean);
  for (let i = 0; i < sentences.length; i += 1) {
    const segment = sentences[i].trim();
    if (!segment.length) continue;
    await audioCtx.resume();
    // eslint-disable-next-line no-await-in-loop — intentional queue preserves order / decode safety
    await speakSegmentFetch({ secrets, segment, audioCtx, onSentenceStart });
  }
}

/**
 * @param {{
 *   secrets: ResolvedSecrets,
 *   segment: string,
 *   audioCtx: AudioContext,
 *   onSentenceStart?: (sentence: string) => void,
 * }} _
 * @returns {Promise<{duration:number}>}
 */
async function speakSegmentFetch({ secrets, segment, audioCtx, onSentenceStart }) {
  onSentenceStart?.(segment);
  await audioCtx.resume();

  const voiceId = secrets.elevenLabsVoiceId;
  const upstream =
    secrets.elevenLabsProxyUrl ||
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`;

  const payload = JSON.stringify({
    text: segment,
    model_id: secrets.elevenLabsModelId,
    optimize_streaming_latency: 4,
    output_format: "mp3_44100_128",
  });

  let res = await fetch(upstream, {
    method: "POST",
    headers: {
      Accept: "audio/mpeg",
      "Content-Type": "application/json",
      "xi-api-key": secrets.elevenLabsApiKey,
    },
    body: payload,
    mode: "cors",
    cache: "no-store",
  });

  if (
    (!res.ok && secrets.elevenLabsProxyUrl) ||
    (res.status === 401 && secrets.elevenLabsProxyUrl)
  ) {
    res = await fetch(secrets.elevenLabsProxyUrl, {
      method: "POST",
      headers: {
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
      },
      body: payload,
      mode: "cors",
      cache: "no-store",
    });
  }

  if (!res.ok) {
    const errTxt = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status}: ${errTxt.slice(0, 280)}`);
  }

  const mp3bytes = await res.arrayBuffer();
  const copy = mp3bytes.slice();
  const audioBuffer = await audioCtx.decodeAudioData(copy);
  /** @type {AudioBufferSourceNode} */
  const node = audioCtx.createBufferSource();
  node.buffer = audioBuffer;
  node.connect(audioCtx.destination);

  await new Promise((resolve, reject) => {
    node.onended = () => resolve();
    try {
      node.start(audioCtx.currentTime);
    } catch (e) {
      reject(e);
    }
  });

  const duration =
    typeof audioBuffer.duration === "number" ? audioBuffer.duration : 0.5;
  return { duration };
}

/** @param {string} paragraph */
export function chunkTextForSpeech(paragraph) {
  /** Split loosely on sentence boundaries but keep commas for very short replies */
  const bits = `${paragraph}`
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Za-z0-9])/u)
    .map((x) => x.trim())
    .filter(Boolean);

  if (bits.length) return flattenLongChunks(bits);

  const fallback = `${paragraph}`.trim();
  return flattenLongChunks(fallback.length ? [fallback] : []);
}

/** @param {string[]} raw */
function flattenLongChunks(raw) {
  const maxLen = 360;
  const out = [];

  raw.forEach((piece) => {
    if (!piece.trim()) return;
    if (piece.length <= maxLen) {
      out.push(piece);
      return;
    }

    /** Hard wrap very long blobs */
    let cursor = 0;
    while (cursor < piece.length) {
      out.push(piece.slice(cursor, cursor + maxLen));
      cursor += maxLen;
    }
  });

  return out;
}
