/** @typedef {'A' | 'B' | 'C' | 'D'} ButtonId */

const LETTERS = /** @type {const} */ (["A", "B", "C", "D"]);

/** @typedef {{ kind: 'all', value: boolean } | { kind: 'buttons', buttons: Partial<Record<ButtonId, boolean>> } | null } ParseResult */

/**
 * @param {string} transcript
 * @returns {ParseResult}
 */
export function parseButtonCommand(transcript) {
  const s = transcript.toLowerCase().replace(/\s+/g, " ").trim();
  if (!s) return null;

  if (
    /\b(enable|activate|turn on)\s+all\b/.test(s) ||
    /\ball\s+buttons\s+(are\s+)?(on|enabled|active)\b/.test(s) ||
    /\bactivate\s+(?:all(\s+(?:the\s+)?buttons)?|every\b)/.test(s) ||
    /\bturn\s+on\s+(all(\s+(?:the\s+)?buttons)?|every\b)/.test(s)
  ) {
    return { kind: "all", value: true };
  }

  if (
    /\b(disable|deactivate|turn off)\s+all\b/.test(s) ||
    /\ball\s+buttons\s+(are\s+)?(off|disabled|inactive)\b/.test(s) ||
    /\bturn\s+off\s+(all(\s+(?:the\s+)?buttons)?)\b/.test(s)
  ) {
    return { kind: "all", value: false };
  }

  /** @type {Partial<Record<ButtonId, boolean>>} */
  const buttons = {};

  /**
   * Split so each clause begins with a control verb — supports "Turn on B and disable D".
   * First segment keeps its leading verbs (often the full mixed sentence).
   */
  const segments = s
    .split(/\s+(?=(?:enable|activate|turn on|disable|deactivate|turn off)\b)/i)
    .map((p) => p.trim())
    .filter(Boolean);

  for (const segment of segments) {
    /** @type {boolean | null} */
    let on = null;
    let rest = segment;

    const onMatch = /^(enable|activate|turn on)\b\s*(.*)$/i.exec(segment);
    const offMatch = /^(disable|deactivate|turn off)\b\s*(.*)$/i.exec(segment);

    if (onMatch) {
      on = true;
      rest = onMatch[2];
    } else if (offMatch) {
      on = false;
      rest = offMatch[2];
    } else {
      continue;
    }

    lettersFromPhrase(rest).forEach((id) => {
      buttons[id] = /** @type {boolean} */ (on);
    });
  }

  if (Object.keys(buttons).length === 0) {
    return null;
  }

  return { kind: "buttons", buttons };
}

/** @returns {ButtonId[]} */
function lettersFromPhrase(phrase) {
  const set = /** @type {Set<ButtonId>} */ (new Set());
  const p = phrase.toLowerCase();
  p.replace(/\b(?:buttons?\s+)?([abcd])\b/g, (_, letter) => {
    const id = letter.toUpperCase();
    if (LETTERS.includes(id)) set.add(id);
    return "";
  });
  return [...set];
}

/**
 * @param {Record<ButtonId, boolean>} before
 * @param {Record<ButtonId, boolean>} after
 * @param {NonNullable<ParseResult>} parsed
 */
export function formatConfirmation(before, after, parsed) {
  if (parsed.kind === "all") {
    return parsed.value
      ? "All buttons are now active, Sir."
      : "All buttons are now inactive, Sir.";
  }

  const turnedOn = [];
  const turnedOff = [];

  for (const id of LETTERS) {
    const was = before[id];
    const now = after[id];
    if (was === now) continue;
    if (now) turnedOn.push(id);
    else turnedOff.push(id);
  }

  /** If parser set state but overlap hid delta, narrate targets. */
  if (turnedOn.length === 0 && turnedOff.length === 0) {
    const labels = LETTERS.filter((id) => parsed.buttons[id] !== undefined);
    if (!labels.length) return "Confirmed, Sir.";
    const vals = [...new Set(labels.map((id) => parsed.buttons[id]))];
    if (vals.length === 1) {
      const on = vals[0];
      return `${listLetters(labels)} ${labels.length > 1 ? "are" : "is"} now ${on ? "active" : "inactive"}, Sir.`;
    }
  }

  const parts = [];
  if (turnedOn.length)
    parts.push(`${listLetters(turnedOn)} ${turnedOn.length > 1 ? "are" : "is"} now active`);
  if (turnedOff.length)
    parts.push(`${listLetters(turnedOff)} ${turnedOff.length > 1 ? "are" : "is"} now inactive`);

  return parts.length ? `${parts.join(". ")}, Sir.` : "Confirmed, Sir.";
}

/** @param {ButtonId[]} arr */
function listLetters(arr) {
  if (arr.length === 1) return `Button ${arr[0]}`;
  const tail = arr[arr.length - 1];
  const head = arr.slice(0, -1).join(", ");
  return `Buttons ${head} and ${tail}`;
}

/** @typedef {{ role: 'user' | 'assistant' | 'system', content: string }} ChatTurn */

/** @typedef {{ stand_down?: boolean, all_buttons?: boolean | null, button_updates?: Partial<Record<ButtonId, boolean>>, buttons?: Partial<Record<ButtonId, boolean>>, reply?: string }} RelayShape */

const RELAY_PROMPT_BODY = `
You are "Jarvis", a meticulous British-accented tactical AI concierge for a futuristic smart dashboard.
Maintain brevity, dry wit, and military politeness toward the user whom you refer to occasionally as Sir.
You supervise four binary relays labelled A,B,C,D. They can be commanded on/off collectively or selectively.

RULES — respond with VALID JSON ONLY (no markdown fences, no preamble):
{
  "stand_down": boolean,
  "all_buttons": true | false | null,
  "button_updates": { "A": true | false , ... optional keys },
  "reply": string
}

FIELD GUIDANCE
- Always include "reply".
- If the utterance triggers sleep / dismissal / stand down / go to sleep, set stand_down:true and politely confirm in reply.
- If the utterance adjusts relays, populate all_buttons OR button_updates; otherwise both may be null/empty objects.
  * all_buttons:null when not relevant.
  * button_updates:{} when unused.
  * Only reference keys A,B,C,D.
- Casual conversation should keep relay fields null/absent besides empty object and stand_down:false.
- When uncertain, apologize briefly in reply yet keep relays unchanged while narrating ambiguity.

REFERENCE EXAMPLES
USER: Enable button A → {"stand_down":false,"all_buttons":null,"button_updates":{"A":true},"reply":"Certainly, Sir. Relay Alpha is armed."}
USER: Toggle off B → {"stand_down":false,"all_buttons":null,"button_updates":{"B":false},"reply":"Relay Bravo disengaged, Sir."}
USER: Turn on everything → {"stand_down":false,"all_buttons":true,"button_updates":{},"reply":"Acknowledged — all relays energized."}

Keep JSON compact and syntactically perfect.
`.trim();

/**
 * @param {readonly ChatTurn[]} history
 * @param {string} userText
 * @returns {ChatTurn[]}
 */
export function createGroqMessageList(history, userText) {
  const trimmedUser = `${userText}`.trim();
  /** @type {ChatTurn[]} */
  let turns = [...history];
  /** Cap conversational turns forwarded to Groq */
  const maxTurns = 12;
  if (turns.length > maxTurns) {
    turns = turns.slice(turns.length - maxTurns);
  }

  return [
    { role: "system", content: RELAY_PROMPT_BODY },
    ...turns,
    trimmedUser.length
      ? /** @type {ChatTurn} */ ({ role: "user", content: trimmedUser })
      : /** @type {ChatTurn} */ ({ role: "user", content: "(silence)" }),
  ];
}

/**
 * Normalizes Groq JSON fields into deterministic ParseResult (null preserves buttons).
 * @param {RelayShape | undefined} relayPayload
 * @returns {ParseResult | null}
 */
export function relayJsonToButtonParse(relayPayload) {
  if (!relayPayload) return null;

  const all = relayPayload.all_buttons;
  if (typeof all === "boolean") {
    return { kind: "all", value: all };
  }

  const merged = relayPayload.button_updates ?? relayPayload.buttons ?? null;
  if (!merged || typeof merged !== "object") return null;

  /** @type {Partial<Record<ButtonId, boolean>>} */
  const normalized = {};
  LETTERS.forEach((id) => {
    const lower = /** @type {string} */ (id.toLowerCase());
    /** @type {unknown} */
    const val = merged[id];
    /** @type {unknown} */
    const lowVal = merged[lower];
    if (typeof val === "boolean") normalized[id] = val;
    else if (typeof lowVal === "boolean") normalized[id] = lowVal;
  });

  return Object.keys(normalized).length
    ? { kind: "buttons", buttons: normalized }
    : null;
}
