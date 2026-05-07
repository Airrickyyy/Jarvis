import {
  CLAP_AUDIO_THRESHOLD_BASE,
  CLAP_GAP_MIN_MS,
  CLAP_GAP_MAX_MS,
  CLAP_DEBOUNCE_MS,
  CLAP_DYNAMIC_NOISE_MULTIPLIER,
  CLAP_INITIAL_NOISE_FLOOR,
  CLAP_NOISE_SMOOTHING,
} from "./constants.js";

/**
 * PCM double-clap detection (integrated from original clap-switch logic).
 * @param {{ onDoubleClap: () => void }} handlers
 */
export function createClapDetector({ onDoubleClap }) {
  let audioContext = null;
  let source = null;
  let processor = null;
  let lastClapMs = 0;
  let noiseFloor = CLAP_INITIAL_NOISE_FLOOR;

  function handleClap(nowMs) {
    if (nowMs - lastClapMs < CLAP_DEBOUNCE_MS) {
      return;
    }

    const gap = nowMs - lastClapMs;
    if (gap >= CLAP_GAP_MIN_MS && gap <= CLAP_GAP_MAX_MS) {
      onDoubleClap();
      lastClapMs = 0;
      return;
    }

    lastClapMs = nowMs;
  }

  function processAudio(event) {
    const input = event.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < input.length; i += 1) {
      sum += input[i] * input[i];
    }

    const rms = Math.sqrt(sum / input.length);
    noiseFloor = noiseFloor * CLAP_NOISE_SMOOTHING + rms * (1 - CLAP_NOISE_SMOOTHING);
    const dynamicThreshold = Math.max(
      CLAP_AUDIO_THRESHOLD_BASE,
      noiseFloor * CLAP_DYNAMIC_NOISE_MULTIPLIER
    );

    if (rms > dynamicThreshold) {
      handleClap(Date.now());
    }
  }

  return {
    /**
     * @param {AudioContext} ctx
     * @param {MediaStream} stream
     */
    start(ctx, stream) {
      source = ctx.createMediaStreamSource(stream);
      processor = ctx.createScriptProcessor(2048, 1, 1);
      processor.onaudioprocess = processAudio;
      source.connect(processor);
      processor.connect(ctx.destination);
    },

    stop() {
      if (processor) {
        processor.disconnect();
        processor.onaudioprocess = null;
        processor = null;
      }
      if (source) {
        source.disconnect();
        source = null;
      }
      lastClapMs = 0;
      noiseFloor = CLAP_INITIAL_NOISE_FLOOR;
    },
  };
}
