// Constants for Memory Management
const MEM_LIMIT: u32 = 524288000;
const FREQ_LIST_PTR: u32 = 1024;
const AUDIO_PTR: u32 = 65536;
const OUTPUT_PTR: u32 = 64000000;

export function computeCWT(): i32 {
  // Load Parameters
  const tStart = load<u32>(0);
  const tEnd = load<u32>(4);
  const freqCount = load<u32>(8);
  const outputMode = load<u32>(12); // 0: Mag, 1: Phase

  const numSamples = tEnd - tStart;
  const totalOutputSize = numSamples * freqCount * 4;

  // Safety Bound Check
  if (OUTPUT_PTR + totalOutputSize > MEM_LIMIT) {
    return -1; // Error: Out of bounds
  }

  const sampleRate: f32 = 48000.0;
  const w0: f32 = 6.0; // Standard Morlet center frequency

  for (let fIdx: u32 = 0; fIdx < freqCount; fIdx++) {
    const freq = load<f32>(FREQ_LIST_PTR + (fIdx * 4));
    const scale = w0 / (2.0 * Mathf.PI * freq);
    const scalingFactor = 1.0 / Mathf.sqrt(scale);
    
    // Kernel window (3 standard deviations)
    const window = <i32>(3.0 * scale * sampleRate);

    for (let t: u32 = tStart; t < tEnd; t++) {
      let realSum: f32 = 0;
      let imagSum: f32 = 0;

      for (let k = -window; k <= window; k++) {
        const inputIdx = <i32>t + k;
        
        // Input is filled regardless of tStart/tEnd; boundary check against 5-min limit
        if (inputIdx >= 0 && inputIdx < 14400000) {
          const signal = load<f32>(AUDIO_PTR + (inputIdx * 4));
          const tau = <f32>k / sampleRate;
          const x = tau / scale;

          // Morlet Wavelet
          const envelope = Mathf.exp(-0.5 * x * x) * scalingFactor;
          const osc = w0 * x;
          
          realSum += signal * envelope * Mathf.cos(osc);
          imagSum -= signal * envelope * Mathf.sin(osc);
        }
      }

      let result: f32 = 0;
      if (outputMode == 0) {
        result = Mathf.sqrt(realSum * realSum + imagSum * imagSum);
      } else {
        result = Mathf.atan2(imagSum, realSum);
      }

      const outOffset = OUTPUT_PTR + (((fIdx * numSamples) + (t - tStart)) * 4);
      store<f32>(outOffset, result);
    }
  }
  return 0; // Success
}
