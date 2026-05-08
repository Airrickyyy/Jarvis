/**
 * Clap detector tuning (`clapDetector.js`). Raised values reject ambient noise spikes.
 */
export const CLAP_AUDIO_THRESHOLD_BASE = 0.14;

export const CLAP_GAP_MIN_MS = 120;
export const CLAP_GAP_MAX_MS = 650;
export const CLAP_DEBOUNCE_MS = 110;

/** Dynamic threshold = max(CLAP_AUDIO_THRESHOLD_BASE, noiseFloor × this) */
export const CLAP_DYNAMIC_NOISE_MULTIPLIER = 3.0;

/** Initial noise RMS estimate before adapting */
export const CLAP_INITIAL_NOISE_FLOOR = 0.02;

/** Adaptive noise smoothing (higher = slower to drift) */
export const CLAP_NOISE_SMOOTHING = 0.98;

/** Wake phrase (speech tolerance). */
export const WAKE_PHRASE_REGEX = /wake\s*(up)?/i;

/** After double-clap, accept “wake up” within this window (ms). */
export const WAKE_PHRASE_WINDOW_MS = 7000;

export const RECOG_LANG = "en-US";
export const SPEAK_LANG = "en-US";
