// assembly/index.ts

// --- Configuration Constants ---
// 5 mins * 60 sec * 48000 samples * 4 bytes (f32) = 57,600,000 bytes
const MAX_AUDIO_DURATION_SEC: f32 = 300.0;
const SAMPLE_RATE: f32 = 48000.0;
const AUDIO_BUFFER_SIZE: i32 = 57_600_000; 

// Reserve space for up to 10,000 frequencies (40KB)
const FREQ_BUFFER_SIZE: i32 = 10_000 * 4;

// Reserve space for a temporary Kernel buffer
const KERNEL_BUFFER_SIZE: i32 = 1_000_000;

// --- Memory Layout ---
export const PTR_AUDIO: i32 = 0;
export const PTR_FREQS: i32 = PTR_AUDIO + AUDIO_BUFFER_SIZE;
export const PTR_KERNEL: i32 = PTR_FREQS + FREQ_BUFFER_SIZE;
export const PTR_OUTPUT: i32 = PTR_KERNEL + KERNEL_BUFFER_SIZE;

// 500MB Total Limit
const MAX_MEMORY_LIMIT: i32 = 500 * 1024 * 1024;
const AVAILABLE_OUTPUT_MEM: i32 = MAX_MEMORY_LIMIT - PTR_OUTPUT;

// --- Math Constants (Complex Morlet) ---
// Using 'f' suffix for literals ensures they are treated as f32 if needed, 
// though constants usually handle it. 
const PI: f32 = 3.14159265358979323846;
const OMEGA_0: f32 = 6.0; 
const SQRT_PI: f32 = 1.77245385091;

// --- Helper Functions to Expose Pointers ---
export function getAudioBufferPtr(): i32 { return PTR_AUDIO; }
export function getFreqBufferPtr(): i32 { return PTR_FREQS; }
export function getOutputBufferPtr(): i32 { return PTR_OUTPUT; }

/**
 * Main Compute Function
 */
export function computeCWT(tStart: i32, tEnd: i32, numFreqs: i32, outputMode: i32): i32 {
  // 1. Validation
  let duration: i32 = tEnd - tStart;
  if (duration <= 0 || numFreqs <= 0) return -2;

  // 2. Safety Check: Memory Bounds
  let neededBytes: i32 = duration * numFreqs * 4;
  if (neededBytes > AVAILABLE_OUTPUT_MEM) {
    return -1; 
  }

  let outputCursor: i32 = PTR_OUTPUT;

  // 3. Loop through Frequencies
  for (let fIdx: i32 = 0; fIdx < numFreqs; fIdx++) {
    let freq: f32 = load<f32>(PTR_FREQS + (fIdx * 4));
    
    // Calculate Scale
    let scale: f32 = (OMEGA_0 * SAMPLE_RATE) / (2.0 * PI * freq);
    
    let halfWidth: i32 = <i32>Math.ceil(scale * 2.5);
    let kernelLen: i32 = halfWidth * 2 + 1;

    // --- Precompute Kernel ---
    // FIXED: Added <f32> cast to the result of Math.sqrt
    let normFactor: f32 = <f32>(1.0 / (Math.sqrt(scale) * SQRT_PI)); 
    
    for (let k: i32 = 0; k < kernelLen; k++) {
      let t: f32 = <f32>(k - halfWidth) / scale; 
      
      // FIXED: Added <f32> cast to Math.exp
      let gaussian: f32 = <f32>Math.exp(-0.5 * t * t);
      
      // FIXED: Added <f32> cast to Math.cos and Math.sin
      // Note: We cast the Math result immediately so the multiplication happens in f32
      let real: f32 = gaussian * <f32>Math.cos(OMEGA_0 * t) * normFactor;
      let imag: f32 = gaussian * <f32>Math.sin(OMEGA_0 * t) * normFactor;
      
      store<f32>(PTR_KERNEL + (k * 8), real);     
      store<f32>(PTR_KERNEL + (k * 8) + 4, imag); 
    }

    // --- Time Convolution ---
    for (let t: i32 = tStart; t < tEnd; t++) {
      let sumR: f32 = 0.0;
      let sumI: f32 = 0.0;

      for (let k: i32 = 0; k < kernelLen; k++) {
        let sampleIdx: i32 = t + k - halfWidth;

        // Boundary Check (Hardcoded audio buffer size limit for safety)
        if (sampleIdx >= 0 && sampleIdx < (AUDIO_BUFFER_SIZE / 4)) {
           let sampleVal: f32 = load<f32>(PTR_AUDIO + (sampleIdx * 4));
           let kR: f32 = load<f32>(PTR_KERNEL + (k * 8));
           let kI: f32 = load<f32>(PTR_KERNEL + (k * 8) + 4);

           sumR += sampleVal * kR;
           sumI += sampleVal * kI;
        }
      }

      // Output Calculation
      let result: f32 = 0.0;
      if (outputMode == 0) {
        // Magnitude
        // FIXED: Added <f32> cast
        result = <f32>Math.sqrt(sumR * sumR + sumI * sumI);
      } else {
        // Phase
        // FIXED: Added <f32> cast
        result = <f32>Math.atan2(sumI, sumR);
      }

      store<f32>(outputCursor, result);
      outputCursor += 4;
    }
  }

  return 0; 
}
