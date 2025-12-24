// index.ts - AssemblyScript CWT implementation

/**
 * Performs a Morlet Wavelet CWT convolution on a specific frequency.
 * Designed to be called per frequency to allow for external parallelism or progress tracking.
 */
export function computeCWTForFreq(
  audioPtr: Float32Array,
  nSamples: i32,
  sampleRate: f32,
  freq: f32,
  omega0: f32,
  outputPtr: Float32Array // Buffer to store magnitude results for this freq
): void {
  const PI2: f32 = f32(Math.PI * 2.0);
  const scale: f32 = (omega0 / (PI2 * freq)) * sampleRate;
  const support: i32 = i32(Math.ceil(3.0 * scale));
  const invSqrtScale: f32 = 1.0 / f32(Math.sqrt(scale));

  for (let t: i32 = 0; t < nSamples; t++) {
    let sumReal: f32 = 0.0;
    let sumImag: f32 = 0.0;

    // Convolution loop
    for (let dt: i32 = -support; dt <= support; dt++) {
      const idx: i32 = t + dt;
      if (idx >= 0 && idx < nSamples) {
        const tau: f32 = f32(dt) / scale;
        const gaussian: f32 = f32(Math.exp(-0.5 * tau * tau));
        const phase: f32 = omega0 * tau;

        const val: f32 = audioPtr[idx];
        sumReal += val * gaussian * f32(Math.cos(phase));
        sumImag += val * gaussian * f32(Math.sin(phase));
      }
    }

    // Magnitude calculation: sqrt(r^2 + i^2) / sqrt(scale)
    outputPtr[t] = f32(Math.sqrt(sumReal * sumReal + sumImag * sumImag)) * invSqrtScale;
  }
}
