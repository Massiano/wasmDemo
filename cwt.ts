// Memory Constants
const MEM_LIMIT: u32 = 536870912; // 512 MiB
const AUDIO_PTR: u32 = 65536;    // 64 KiB
const OUTPUT_PTR: u32 = 67108864; // 64 MiB
const FREQ_LIST_PTR: u32 = 1024; // 1 KiB

export function computeCWT(): i32 {
  // 1. Read parameters from the start of memory
  const tStart    = load<u32>(0);
  const tEnd      = load<u32>(4);
  const freqCount = load<u32>(8);
  const outputMode = load<u32>(12); // 0 = Mag, 1 = Phase
  const sampleRate: f32 = 48000.0;
  const w0: f32 = 6.0;

  const numSamples = tEnd - tStart;

  // 2. Safety Check
  if (OUTPUT_PTR + (numSamples * freqCount * 4) > MEM_LIMIT) return -1;

  // 3. Main Loops
  for (let fIdx: u32 = 0; fIdx < freqCount; fIdx++) {
    const freq = load<f32>(FREQ_LIST_PTR + (fIdx * 4));
    const scale = w0 / (2.0 * Mathf.PI * freq);
    const scalingFactor = 1.0 / Mathf.sqrt(scale);
    const window = <i32>(3.0 * scale * sampleRate);

    for (let t = tStart; t < tEnd; t++) {
      let realSum: f32 = 0;
      let imagSum: f32 = 0;

      for (let k = -window; k <= window; k++) {
        const inputIdx = <i32>t + k;
        // Check bounds against the 5-min audio limit (14.4M samples)
        if (inputIdx >= 0 && inputIdx < 14400000) {
          const signal = load<f32>(AUDIO_PTR + (inputIdx * 4));
          const x = (<f32>k / sampleRate) / scale;
          const envelope = Mathf.exp(-0.5 * x * x) * scalingFactor;
          
          realSum += signal * envelope * Mathf.cos(w0 * x);
          imagSum -= signal * envelope * Mathf.sin(w0 * x);
        }
      }

      const outIdx = OUTPUT_PTR + (((fIdx * numSamples) + (t - tStart)) * 4);
      store<f32>(outIdx, (outputMode == 0) 
        ? Mathf.sqrt(realSum * realSum + imagSum * imagSum) 
        : Mathf.atan2(imagSum, realSum)
      );
    }
  }
  return 0;
}
