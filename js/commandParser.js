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
