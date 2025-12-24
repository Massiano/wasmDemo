// assembly/index.ts

// --- Configuration ---
// Safety Offset: 1MB to protect stack/globals (CRITICAL FIX from previous step)
const MEMORY_OFFSET: i32 = 1024 * 1024; 

const MAX_AUDIO_DURATION_SEC: f32 = 300.0;
const SAMPLE_RATE: f32 = 48000.0;
const AUDIO_BUFFER_SIZE: i32 = 57_600_000; 
const FREQ_BUFFER_SIZE: i32 = 10_000 * 4;
const KERNEL_BUFFER_SIZE: i32 = 1_000_000;

// New: Debug Buffer (1KB is plenty)
const DEBUG_BUFFER_SIZE: i32 = 1024; 

// --- Memory Layout ---
export const PTR_AUDIO: i32 = MEMORY_OFFSET;
export const PTR_FREQS: i32 = PTR_AUDIO + AUDIO_BUFFER_SIZE;
export const PTR_KERNEL: i32 = PTR_FREQS + FREQ_BUFFER_SIZE;
export const PTR_OUTPUT: i32 = PTR_KERNEL + KERNEL_BUFFER_SIZE;
export const PTR_DEBUG: i32 = PTR_OUTPUT + MAX_AUDIO_DURATION_SEC as i32 * 48000 * 10; // Place at end, strictly speaking we have 500MB so plenty of room

const MAX_MEMORY_LIMIT: i32 = 500 * 1024 * 1024;
const AVAILABLE_OUTPUT_MEM: i32 = MAX_MEMORY_LIMIT - PTR_OUTPUT;

// --- Constants ---
const PI: f32 = 3.14159265359;
const OMEGA_0: f32 = 6.0; 
const SQRT_PI: f32 = 1.77245385;

// --- Helper Functions ---
export function getAudioBufferPtr(): i32 { return PTR_AUDIO; }
export function getFreqBufferPtr(): i32 { return PTR_FREQS; }
export function getOutputBufferPtr(): i32 { return PTR_OUTPUT; }
export function getDebugBufferPtr(): i32 { return PTR_DEBUG; }

export function computeCWT(tStart: i32, tEnd: i32, numFreqs: i32, outputMode: i32): i32 {
  // 1. Validation & Safety
  let duration: i32 = tEnd - tStart;
  if (duration <= 0 || numFreqs <= 0) return -2;
  
  // 2. Clear Debug Area (Optional, but good for clarity)
  // We will write 10 debug values.
  
  let outputCursor: i32 = PTR_OUTPUT;

  // 3. Loop Frequencies
  for (let fIdx: i32 = 0; fIdx < numFreqs; fIdx++) {
    // Load frequency
    let freq: f32 = load<f32>(PTR_FREQS + (fIdx * 4));
    
    // Scale Calculation
    let scale: f32 = (OMEGA_0 * SAMPLE_RATE) / (2.0 * PI * freq);
    
    // Kernel Width
    let halfWidth: i32 = <i32>Mathf.ceil(scale * 2.5);
    let kernelLen: i32 = halfWidth * 2 + 1;
    
    // Precompute Kernel
    let normFactor: f32 = 1.0 / (Mathf.sqrt(scale) * SQRT_PI); 

    // --- DIAGNOSTIC A: Check Frequency Params (Index 0-3) ---
    // Only capture for the first frequency
    if (fIdx == 0) {
        store<f32>(PTR_DEBUG + 0, freq);         // [0] Input Freq
        store<f32>(PTR_DEBUG + 4, scale);        // [1] Calculated Scale
        store<f32>(PTR_DEBUG + 8, <f32>halfWidth); // [2] Half Width
        store<f32>(PTR_DEBUG + 12, normFactor);  // [3] Norm Factor
    }

    // Kernel Generation Loop
    for (let k: i32 = 0; k < kernelLen; k++) {
      let t: f32 = <f32>(k - halfWidth) / scale; 
      let gaussian: f32 = Mathf.exp(-0.5f * t * t);
      
      let real: f32 = gaussian * Mathf.cos(OMEGA_0 * t) * normFactor;
      let imag: f32 = gaussian * Mathf.sin(OMEGA_0 * t) * normFactor;
      
      store<f32>(PTR_KERNEL + (k * 8), real);     
      store<f32>(PTR_KERNEL + (k * 8) + 4, imag); 
      
      // --- DIAGNOSTIC B: Check Kernel Generation (Index 4-5) ---
      // Store the center point of the kernel (k == halfWidth)
      if (fIdx == 0 && k == halfWidth) {
          store<f32>(PTR_DEBUG + 16, real); // [4] Center Kernel Real (should be high)
          store<f32>(PTR_DEBUG + 20, imag); // [5] Center Kernel Imag (should be 0)
      }
    }

    // Convolution Loop
    for (let t: i32 = tStart; t < tEnd; t++) {
      let sumR: f32 = 0.0;
      let sumI: f32 = 0.0;
      
      // We only debug the VERY FIRST time step of the FIRST frequency
      let isDebugStep: boolean = (fIdx == 0 && t == tStart);

      for (let k: i32 = 0; k < kernelLen; k++) {
        let sampleIdx: i32 = t + k - halfWidth;

        if (sampleIdx >= 0 && sampleIdx < 14400000) { 
           let sampleVal: f32 = load<f32>(PTR_AUDIO + (sampleIdx * 4));
           let kR: f32 = load<f32>(PTR_KERNEL + (k * 8));
           let kI: f32 = load<f32>(PTR_KERNEL + (k * 8) + 4);

           sumR += sampleVal * kR;
           sumI += sampleVal * kI;

           // --- DIAGNOSTIC C: Check Audio Input (Index 6) ---
           // Store the sample value at the center of the kernel
           if (isDebugStep && k == halfWidth) {
               store<f32>(PTR_DEBUG + 24, sampleVal); // [6] Audio Sample at Center
           }
        }
      }

      // Output Calculation
      let result: f32 = 0.0;
      if (outputMode == 0) {
        result = Mathf.sqrt(sumR * sumR + sumI * sumI);
      } else {
        result = Mathf.atan2(sumI, sumR);
      }
      
      // --- DIAGNOSTIC D: Final Sums (Index 7-8) ---
      if (isDebugStep) {
          store<f32>(PTR_DEBUG + 28, sumR);   // [7] Final Sum Real
          store<f32>(PTR_DEBUG + 32, result); // [8] Final Result Magnitude
      }

      store<f32>(outputCursor, result);
      outputCursor += 4;
    }
  }
  return 0;
}
