// CWT Engine v1.0 - Fixed memory layout, magnitude only
// Compile: asc cwt.ts -o cwt.wasm -O3 --runtime stub --memoryBase 0 --initialMemory 8192

// ============================================================
// MEMORY LAYOUT (fixed, no allocator)
// ============================================================
// 0x0000 - 0x00FF : Header (256 bytes)
// 0x0100 - AUDIO_END : Audio samples (f32[], max 5 min @ 48kHz mono)
// AUDIO_END - ... : CWT magnitude output (f32[n_freqs × n_time_samples])
// ============================================================


// Header offsets (bytes)
const HEADER_START: usize = 1024; // Move everything up!

const HEADER_SAMPLE_RATE: usize = 0;      // f32
const HEADER_N_SAMPLES: usize = 4;         // u32
const HEADER_N_FREQS: usize = 8;           // u32
const HEADER_N_TIME_OUT: usize = 12;       // u32 (output time resolution)
const HEADER_FREQ_MIN: usize = 16;         // f32
const HEADER_FREQ_MAX: usize = 20;         // f32
const HEADER_OMEGA0: usize = 24;           // f32
const HEADER_TIME_STEP: usize = 28;        // u32 (samples between output points)
const HEADER_PROGRESS: usize = 32;         // f32 (0.0 - 1.0)
const HEADER_STATUS: usize = 36;           // u32 (0=idle, 1=running, 2=done, 3=error)
const HEADER_MAX_MAG: usize = 40;          // f32 (for normalization)

const AUDIO_START: usize = 256;
const MAX_AUDIO_SAMPLES: u32 = 48000 * 300; // 5 min @ 48kHz
const CWT_START: usize = AUDIO_START + <usize>MAX_AUDIO_SAMPLES * 4;

// Status codes
const STATUS_IDLE: u32 = 0;
const STATUS_RUNNING: u32 = 1;
const STATUS_DONE: u32 = 2;
const STATUS_ERROR: u32 = 3;

// ============================================================
// HEADER ACCESS
// ============================================================

@inline
function setSampleRate(v: f32): void { store<f32>(HEADER_SAMPLE_RATE, v); }

@inline
function getSampleRate(): f32 { return load<f32>(HEADER_SAMPLE_RATE); }

@inline
function setNSamples(v: u32): void { store<u32>(HEADER_N_SAMPLES, v); }

@inline
function getNSamples(): u32 { return load<u32>(HEADER_N_SAMPLES); }

@inline
function setNFreqs(v: u32): void { store<u32>(HEADER_N_FREQS, v); }

@inline
function getNFreqs(): u32 { return load<u32>(HEADER_N_FREQS); }

@inline
function setNTimeOut(v: u32): void { store<u32>(HEADER_N_TIME_OUT, v); }

@inline
function getNTimeOut(): u32 { return load<u32>(HEADER_N_TIME_OUT); }

@inline
function setFreqMin(v: f32): void { store<f32>(HEADER_FREQ_MIN, v); }

@inline
function getFreqMin(): f32 { return load<f32>(HEADER_FREQ_MIN); }

@inline
function setFreqMax(v: f32): void { store<f32>(HEADER_FREQ_MAX, v); }

@inline
function getFreqMax(): f32 { return load<f32>(HEADER_FREQ_MAX); }

@inline
function setOmega0(v: f32): void { store<f32>(HEADER_OMEGA0, v); }

@inline
function getOmega0(): f32 { return load<f32>(HEADER_OMEGA0); }

@inline
function setTimeStep(v: u32): void { store<u32>(HEADER_TIME_STEP, v); }

@inline
function getTimeStep(): u32 { return load<u32>(HEADER_TIME_STEP); }

@inline
function setProgress(v: f32): void { store<f32>(HEADER_PROGRESS, v); }

@inline
function setStatus(v: u32): void { store<u32>(HEADER_STATUS, v); }

@inline
function setMaxMag(v: f32): void { store<f32>(HEADER_MAX_MAG, v); }

@inline
function getMaxMag(): f32 { return load<f32>(HEADER_MAX_MAG); }

// ============================================================
// EXPORTED ACCESSORS (for JS)
// ============================================================

export function getAudioStart(): usize { return AUDIO_START; }
export function getCWTStart(): usize { return CWT_START; }
export function getMaxAudioSamples(): u32 { return MAX_AUDIO_SAMPLES; }
export function getProgress(): f32 { return load<f32>(HEADER_PROGRESS); }
export function getStatus(): u32 { return load<u32>(HEADER_STATUS); }
export function getComputedNFreqs(): u32 { return getNFreqs(); }
export function getComputedNTime(): u32 { return getNTimeOut(); }
export function getComputedMaxMag(): f32 { return getMaxMag(); }

// ============================================================
// AUDIO SETUP
// ============================================================

export function setAudioParams(sampleRate: f32, nSamples: u32): void {
  if (nSamples > MAX_AUDIO_SAMPLES) {
    setStatus(STATUS_ERROR);
    return;
  }
  setSampleRate(sampleRate);
  setNSamples(nSamples);
  setStatus(STATUS_IDLE);
}

// ============================================================
// MATH HELPERS
// ============================================================

@inline
function fastExp(x: f64): f64 {
  // For x in reasonable range (-20, 0) for gaussian
  // Using built-in for accuracy, compiler will optimize
  return Math.exp(x);
}

@inline
function fastSin(x: f64): f64 {
  return Math.sin(x);
}

@inline
function fastCos(x: f64): f64 {
  return Math.cos(x);
}

// ============================================================
// CWT CORE
// ============================================================

export function computeCWT(
  freqMin: f32,
  freqMax: f32,
  voicesPerOctave: u32,
  omega0: f32,
  timeStep: u32
): void {
  setStatus(STATUS_RUNNING);
  setProgress(0.0);
  
  const sampleRate = getSampleRate();
  const nSamples = getNSamples();
  
  if (sampleRate <= 0 || nSamples == 0) {
    setStatus(STATUS_ERROR);
    return;
  }
  
  // Store params
  setFreqMin(freqMin);
  setFreqMax(freqMax);
  setOmega0(omega0);
  setTimeStep(timeStep);
  
  // Compute frequency scale (log-spaced)
  const numOctaves: f64 = Math.log2(<f64>freqMax / <f64>freqMin);
  const nFreqs: u32 = <u32>Math.ceil(numOctaves * <f64>voicesPerOctave);
  setNFreqs(nFreqs);
  
  // Output time points
  const nTimeOut: u32 = (nSamples + timeStep - 1) / timeStep;
  setNTimeOut(nTimeOut);
  
  // Morlet normalization constants
  const omega0_64: f64 = <f64>omega0;
  const K_sigma: f64 = Math.exp(-0.5 * omega0_64 * omega0_64);
  const C_sigma: f64 = Math.pow(
    1.0 + Math.exp(-omega0_64 * omega0_64) - 2.0 * Math.exp(-0.75 * omega0_64 * omega0_64),
    -0.5
  );
  const piNorm: f64 = Math.pow(Math.PI, -0.25);
  
  let globalMaxMag: f32 = 0.0;
  
  // For each frequency
  for (let fi: u32 = 0; fi < nFreqs; fi++) {
    // Log-spaced frequency
    const freq: f64 = <f64>freqMin * Math.pow(2.0, <f64>fi / <f64>voicesPerOctave);
    
    // Scale in samples
    const scale: f64 = omega0_64 / (2.0 * Math.PI * freq) * <f64>sampleRate;
    
    // Wavelet support (3 sigma)
    const support: i32 = <i32>Math.ceil(3.0 * scale);
    
    // Normalization factor
    const norm: f64 = 1.0 / Math.sqrt(scale);
    
    // Output row offset
    const rowOffset: usize = CWT_START + <usize>(fi * nTimeOut) * 4;
    
    // For each output time point
    for (let ti: u32 = 0; ti < nTimeOut; ti++) {
      const t0: i32 = <i32>(ti * timeStep);
      
      let sumReal: f64 = 0.0;
      let sumImag: f64 = 0.0;
      
      // Convolve with Morlet wavelet
      for (let dt: i32 = -support; dt <= support; dt++) {
        const t: i32 = t0 + dt;
        if (t < 0 || t >= <i32>nSamples) continue;
        
        // Load audio sample
        const x: f64 = <f64>load<f32>(AUDIO_START + <usize>t * 4);
        
        // Normalized time
        const tau: f64 = <f64>dt / scale;
        
        // Gaussian envelope
        const gaussian: f64 = fastExp(-0.5 * tau * tau);
        
        // Complex Morlet wavelet (with admissibility correction)
        const phase: f64 = omega0_64 * tau;
        const waveletReal: f64 = C_sigma * piNorm * gaussian * (fastCos(phase) - K_sigma);
        const waveletImag: f64 = C_sigma * piNorm * gaussian * fastSin(phase);
        
        sumReal += x * waveletReal;
        sumImag += x * waveletImag;
      }
      
      // Magnitude (normalized)
      const mag: f32 = <f32>(Math.sqrt(sumReal * sumReal + sumImag * sumImag) * norm);
      
      // Track max
      if (mag > globalMaxMag) globalMaxMag = mag;
      
      // Store
      store<f32>(rowOffset + <usize>ti * 4, mag);
    }
    
    // Update progress
    setProgress(<f32>(fi + 1) / <f32>nFreqs);
  }
  
  setMaxMag(globalMaxMag);
  setStatus(STATUS_DONE);
}

// ============================================================
// SINGLE FREQUENCY (for chunked JS control)
// ============================================================

export function computeSingleFreq(
  freqIndex: u32,
  freq: f32,
  omega0: f32,
  timeStep: u32,
  nTimeOut: u32
): f32 {
  const sampleRate = getSampleRate();
  const nSamples = getNSamples();
  
  const omega0_64: f64 = <f64>omega0;
  const K_sigma: f64 = Math.exp(-0.5 * omega0_64 * omega0_64);
  const C_sigma: f64 = Math.pow(
    1.0 + Math.exp(-omega0_64 * omega0_64) - 2.0 * Math.exp(-0.75 * omega0_64 * omega0_64),
    -0.5
  );
  const piNorm: f64 = Math.pow(Math.PI, -0.25);
  
  const freq_64: f64 = <f64>freq;
  const scale: f64 = omega0_64 / (2.0 * Math.PI * freq_64) * <f64>sampleRate;
  const support: i32 = <i32>Math.ceil(3.0 * scale);
  const norm: f64 = 1.0 / Math.sqrt(scale);
  
  const rowOffset: usize = CWT_START + <usize>(freqIndex * nTimeOut) * 4;
  
  let maxMag: f32 = 0.0;
  
  for (let ti: u32 = 0; ti < nTimeOut; ti++) {
    const t0: i32 = <i32>(ti * timeStep);
    
    let sumReal: f64 = 0.0;
    let sumImag: f64 = 0.0;
    
    for (let dt: i32 = -support; dt <= support; dt++) {
      const t: i32 = t0 + dt;
      if (t < 0 || t >= <i32>nSamples) continue;
      
      const x: f64 = <f64>load<f32>(AUDIO_START + <usize>t * 4);
      const tau: f64 = <f64>dt / scale;
      const gaussian: f64 = fastExp(-0.5 * tau * tau);
      const phase: f64 = omega0_64 * tau;
      const waveletReal: f64 = C_sigma * piNorm * gaussian * (fastCos(phase) - K_sigma);
      const waveletImag: f64 = C_sigma * piNorm * gaussian * fastSin(phase);
      
      sumReal += x * waveletReal;
      sumImag += x * waveletImag;
    }
    
    const mag: f32 = <f32>(Math.sqrt(sumReal * sumReal + sumImag * sumImag) * norm);
    if (mag > maxMag) maxMag = mag;
    
    store<f32>(rowOffset + <usize>ti * 4, mag);
  }
  
  return maxMag;
}

// ============================================================
// UTILITY: Clear CWT output region
// ============================================================

export function clearCWT(nFreqs: u32, nTimeOut: u32): void {
  const totalBytes: usize = <usize>(nFreqs * nTimeOut) * 4;
  memory.fill(CWT_START, 0, totalBytes);
  setMaxMag(0.0);
  setProgress(0.0);
  setStatus(STATUS_IDLE);
}
