// assembly/index.ts

// --- Configuration ---
// Safety Offset: 1MB to protect stack/globals
const MEMORY_OFFSET: i32 = 1024 * 1024; 

const MAX_AUDIO_DURATION_SEC: f32 = 300.0;
const SAMPLE_RATE: f32 = 48000.0;
const AUDIO_BUFFER_SIZE: i32 = 57_600_000; 
const FREQ_BUFFER_SIZE: i32 = 10_000 * 4;
const KERNEL_BUFFER_SIZE: i32 = 1_000_000;

// Debug Buffer
const DEBUG_BUFFER_SIZE: i32 = 1024; 

// --- Memory Layout ---
export const PTR_AUDIO: i32 = MEMORY_OFFSET;
export const PTR_FREQS: i32 = PTR_AUDIO + AUDIO_BUFFER_SIZE;
export const PTR_KERNEL: i32 = PTR_FREQS + FREQ_BUFFER_SIZE;
export const PTR_OUTPUT: i32 = PTR_KERNEL + KERNEL_BUFFER_SIZE;
export const PTR_DEBUG: i32 = PTR_OUTPUT + <i32>(MAX_AUDIO_DURATION_SEC * 48000.0 * 10.0); 

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
  // 1. Validation
  let duration: i32 = tEnd - tStart;
  if (duration <= 0 || numFreqs <= 0) return -2;

  let outputCursor: i32 = PTR_OUTPUT;

  // 2. Loop Frequencies
  for (let fIdx: i32 = 0; fIdx < numFreqs; fIdx++) {
    let freq: f32 = load<f32>(PTR_FREQS + (fIdx * 4));
    
    // Scale Calculation
    let scale: f32 = (OMEGA_0 * SAMPLE_RATE) / (2.0 * PI * freq);
    
    // Kernel Width
    let halfWidth: i32 = <i32>Mathf.ceil(scale * 2.5);
    let kernelLen: i32 = halfWidth * 2 + 1;
    
    // Precompute Kernel
    // Note: No 'f' suffixes here. 1.0 is valid.
    let normFactor: f32 = 1.0 / (Mathf.sqrt(scale) * SQRT_PI); 

    // --- DIAGNOSTIC A ---
    if (fIdx == 0) {
        store<f32>(PTR_DEBUG + 0, freq);         
        store<f32>(PTR_DEBUG + 4, scale);        
        store<f32>(PTR_DEBUG + 8, <f32>halfWidth); 
        store<f32>(PTR_DEBUG + 12, normFactor);  
    }

    // Kernel Generation
    for (let k: i32 = 0; k < kernelLen; k++) {
      let t: f32 = <f32>(k - halfWidth) / scale; 
      
      // FIXED: Removed 'f' suffix. 
      // Added <f32> cast because (-0.5 * t * t) promotes to f64
      let gaussian: f32 = Mathf.exp(<f32>(-0.5 * t * t));
      
      let real: f32 = gaussian * Mathf.cos(OMEGA_0 * t) * normFactor;
      let imag: f32 = gaussian * Mathf.sin(OMEGA_0 * t) * normFactor;
      
      store<f32>(PTR_KERNEL + (k * 8), real);     
      store<f32>(PTR_KERNEL + (k * 8) + 4, imag); 
      
      // --- DIAGNOSTIC B ---
      if (fIdx == 0 && k == halfWidth) {
          store<f32>(PTR_DEBUG + 16, real); 
          store<f32>(PTR_DEBUG + 20, imag); 
      }
    }

    // Convolution
    for (let t: i32 = tStart; t < tEnd; t++) {
      let sumR: f32 = 0.0;
      let sumI: f32 = 0.0;
      
      let isDebugStep: boolean = (fIdx == 0 && t == tStart);

      for (let k: i32 = 0; k < kernelLen; k++) {
        let sampleIdx: i32 = t + k - halfWidth;

        // Hardcoded safety limit
        if (sampleIdx >= 0 && sampleIdx < 14400000) { 
           let sampleVal: f32 = load<f32>(PTR_AUDIO + (sampleIdx * 4));
           let kR: f32 = load<f32>(PTR_KERNEL + (k * 8));
           let kI: f32 = load<f32>(PTR_KERNEL + (k * 8) + 4);

           sumR += sampleVal * kR;
           sumI += sampleVal * kI;

           // --- DIAGNOSTIC C ---
           if (isDebugStep && k == halfWidth) {
               store<f32>(PTR_DEBUG + 24, sampleVal); 
           }
        }
      }

      // Output
      let result: f32 = 0.0;
      if (outputMode == 0) {
        result = Mathf.sqrt(sumR * sumR + sumI * sumI);
      } else {
        result = Mathf.atan2(sumI, sumR);
      }
      
      // --- DIAGNOSTIC D ---
      if (isDebugStep) {
          store<f32>(PTR_DEBUG + 28, sumR);   
          store<f32>(PTR_DEBUG + 32, result); 
      }

      store<f32>(outputCursor, result);
      outputCursor += 4;
    }
  }
  return 0;
}
