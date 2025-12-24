// assembly/index.ts

// --- Configuration Constants ---
// 5 mins * 60 sec * 48000 samples * 4 bytes (f32) = 57,600,000 bytes
const MAX_AUDIO_DURATION_SEC: f32 = 300.0;
const SAMPLE_RATE: f32 = 48000.0;
const AUDIO_BUFFER_SIZE: i32 = 57_600_000; 

// Reserve space for up to 10,000 frequencies (40KB)
const FREQ_BUFFER_SIZE: i32 = 10_000 * 4;

// Reserve space for a temporary Kernel buffer (Complex numbers: Re, Im)
// For 20Hz (very low), width is approx 15k samples. 1MB is plenty safe.
const KERNEL_BUFFER_SIZE: i32 = 1_000_000;

// --- Memory Layout ---
// [Audio Data ......] [Frequencies ...] [Kernel Scratch] [OUTPUT ......]
export const PTR_AUDIO: i32 = 0;
export const PTR_FREQS: i32 = PTR_AUDIO + AUDIO_BUFFER_SIZE;
export const PTR_KERNEL: i32 = PTR_FREQS + FREQ_BUFFER_SIZE;
export const PTR_OUTPUT: i32 = PTR_KERNEL + KERNEL_BUFFER_SIZE;

// 500MB Total Limit
const MAX_MEMORY_LIMIT: i32 = 500 * 1024 * 1024;
const AVAILABLE_OUTPUT_MEM: i32 = MAX_MEMORY_LIMIT - PTR_OUTPUT;

// --- Math Constants (Complex Morlet) ---
const PI: f32 = 3.14159265358979323846;
const OMEGA_0: f32 = 6.0; // Standard Morlet parameter
const SQRT_PI: f32 = 1.77245385091;

// --- Helper Functions to Expose Pointers ---
export function getAudioBufferPtr(): i32 { return PTR_AUDIO; }
export function getFreqBufferPtr(): i32 { return PTR_FREQS; }
export function getOutputBufferPtr(): i32 { return PTR_OUTPUT; }

/**
 * Main Compute Function
 * @param tStart Start sample index
 * @param tEnd End sample index (exclusive)
 * @param numFreqs Number of frequencies to process from the freq buffer
 * @param outputMode 0 = Magnitude, 1 = Phase
 * @returns 0 on success, -1 on OOM error, -2 on invalid params
 */
export function computeCWT(tStart: i32, tEnd: i32, numFreqs: i32, outputMode: i32): i32 {
  // 1. Validation
  let duration: i32 = tEnd - tStart;
  if (duration <= 0 || numFreqs <= 0) return -2;

  // 2. Safety Check: Memory Bounds
  // Output is float32 (4 bytes) per time-step per frequency
  let neededBytes: i32 = duration * numFreqs * 4;
  if (neededBytes > AVAILABLE_OUTPUT_MEM) {
    return -1; // Call rejected: Exceeds 500MB limit
  }

  let outputCursor: i32 = PTR_OUTPUT;

  // 3. Loop through Frequencies
  for (let fIdx: i32 = 0; fIdx < numFreqs; fIdx++) {
    // Load frequency from static memory
    let freq: f32 = load<f32>(PTR_FREQS + (fIdx * 4));
    
    // Calculate Scale (s)
    // For Morlet with w0=6, f = (w0 + eta)/(2*pi*s). Approx s = f_s * (w0 / (2*pi*f))
    // Simplified: scale = (OMEGA_0 * SAMPLE_RATE) / (2 * PI * freq)
    let scale: f32 = (OMEGA_0 * SAMPLE_RATE) / (2.0 * PI * freq);
    
    // Determine Kernel Half-Width (3 standard deviations covers ~99.7% of energy)
    // Standard deviation of Morlet time-domain is proportional to scale.
    // Cutoff at roughly 3.0 * scale (in samples, since we normalized scale to fs)
    // Note: The formula derivation depends on specific normalization. 
    // Using standard Morlet width approximation:
    let halfWidth: i32 = <i32>Math.ceil(scale * 2.5);
    let kernelLen: i32 = halfWidth * 2 + 1;

    // --- Precompute Kernel for this frequency (Optimization) ---
    // Storing interleaved Re/Im floats in PTR_KERNEL
    let normFactor: f32 = 1.0 / (Math.sqrt(scale) * SQRT_PI); // Energy Normalization
    
    for (let k: i32 = 0; k < kernelLen; k++) {
      let t: f32 = <f32>(k - halfWidth) / scale; // Normalized time
      let gaussian: f32 = Math.exp(-0.5 * t * t);
      let real: f32 = gaussian * Math.cos(OMEGA_0 * t) * normFactor;
      let imag: f32 = gaussian * Math.sin(OMEGA_0 * t) * normFactor;
      
      store<f32>(PTR_KERNEL + (k * 8), real);     // Store Real
      store<f32>(PTR_KERNEL + (k * 8) + 4, imag); // Store Imag
    }

    // --- Time Convolution ---
    // Convolve the audio signal with the kernel for the requested time window
    for (let t: i32 = tStart; t < tEnd; t++) {
      let sumR: f32 = 0.0;
      let sumI: f32 = 0.0;

      // Inner Convolution Loop
      for (let k: i32 = 0; k < kernelLen; k++) {
        let sampleIdx: i32 = t + k - halfWidth;

        // Boundary Check (Zero padding outside audio buffer)
        if (sampleIdx >= 0 && sampleIdx < (5 * 60 * 48000)) {
           let sampleVal: f32 = load<f32>(PTR_AUDIO + (sampleIdx * 4));
           let kR: f32 = load<f32>(PTR_KERNEL + (k * 8));
           let kI: f32 = load<f32>(PTR_KERNEL + (k * 8) + 4);

           // Complex Multiplication: (a + bi)(c + di) = (ac - bd) + (ad + bc)i
           // Audio sample is Real only (a), so: a*c + a*di
           sumR += sampleVal * kR;
           sumI += sampleVal * kI;
        }
      }

      // Output Calculation
      let result: f32 = 0.0;
      if (outputMode == 0) {
        // Magnitude
        result = Math.sqrt(sumR * sumR + sumI * sumI);
      } else {
        // Phase
        result = Math.atan2(sumI, sumR);
      }

      // Write Result directly to big static block
      store<f32>(outputCursor, result);
      outputCursor += 4;
    }
  }

  return 0; // Success
}
