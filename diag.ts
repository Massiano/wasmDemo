// assembly/debug-test.ts

// Same memory layout as your main module
const MEMORY_OFFSET: i32 = 1024 * 1024;
const AUDIO_BUFFER_SIZE: i32 = 57_600_000;
const FREQ_BUFFER_SIZE: i32 = 10_000 * 4;

export const PTR_AUDIO: i32 = MEMORY_OFFSET;
export const PTR_FREQS: i32 = PTR_AUDIO + AUDIO_BUFFER_SIZE;
export const PTR_DEBUG: i32 = PTR_FREQS + FREQ_BUFFER_SIZE + 1000;

export function getAudioBufferPtr(): i32 { return PTR_AUDIO; }
export function getFreqBufferPtr(): i32 { return PTR_FREQS; }
export function getDebugBufferPtr(): i32 { return PTR_DEBUG; }

// TEST 1: Can we write to debug buffer?
export function testDebugWrite(): void {
    store<f32>(PTR_DEBUG, 123.456);
    store<f32>(PTR_DEBUG + 4, 789.012);
}

// TEST 2: Can we read what JS wrote to audio buffer?
export function testAudioRead(): f32 {
    let val: f32 = load<f32>(PTR_AUDIO);
    store<f32>(PTR_DEBUG + 8, val);  // echo to debug
    return val;
}

// TEST 3: Can we read what JS wrote to freq buffer?
export function testFreqRead(): f32 {
    let val: f32 = load<f32>(PTR_FREQS);
    store<f32>(PTR_DEBUG + 12, val);  // echo to debug
    return val;
}

// TEST 4: Read freq at specific index
export function testFreqReadAt(index: i32): f32 {
    let val: f32 = load<f32>(PTR_FREQS + (index * 4));
    store<f32>(PTR_DEBUG + 16, val);
    return val;
}

// TEST 5: Simple math check
export function testMath(freq: f32): f32 {
    const PI: f32 = 3.14159265;
    const OMEGA_0: f32 = 6.0;
    const SAMPLE_RATE: f32 = 48000.0;
    
    let scale: f32 = (OMEGA_0 * SAMPLE_RATE) / (2.0 * PI * freq);
    store<f32>(PTR_DEBUG + 20, scale);
    return scale;
}

// TEST 6: Full pipeline with explicit freq param (bypass buffer read)
export function testWithDirectFreq(freq: f32): void {
    const PI: f32 = 3.14159265;
    const OMEGA_0: f32 = 6.0;
    const SAMPLE_RATE: f32 = 48000.0;
    const SQRT_PI: f32 = 1.77245385;
    
    store<f32>(PTR_DEBUG + 24, freq);  // [6] input
    
    let scale: f32 = (OMEGA_0 * SAMPLE_RATE) / (2.0 * PI * freq);
    store<f32>(PTR_DEBUG + 28, scale); // [7] scale
    
    let halfWidth: i32 = <i32>Mathf.ceil(scale * 2.5);
    store<f32>(PTR_DEBUG + 32, <f32>halfWidth); // [8] halfWidth
    
    let normFactor: f32 = 1.0 / (Mathf.sqrt(scale) * SQRT_PI);
    store<f32>(PTR_DEBUG + 36, normFactor); // [9] norm
    
    // Sample audio at position 0
    let audioSample: f32 = load<f32>(PTR_AUDIO);
    store<f32>(PTR_DEBUG + 40, audioSample); // [10] audio
}

// TEST 7: Report all pointers for sanity check
export function reportPointers(): void {
    store<i32>(PTR_DEBUG + 44, PTR_AUDIO);
    store<i32>(PTR_DEBUG + 48, PTR_FREQS);
    store<i32>(PTR_DEBUG + 52, PTR_DEBUG);
}
