export function l2normalize(v: Float32Array | number[]): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const inv = sum > 0 ? 1 / Math.sqrt(sum) : 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] * inv;
  return out;
}

export function quantize(v: Float32Array): Int8Array {
  const out = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) {
    out[i] = Math.max(-127, Math.min(127, Math.round(v[i] * 127)));
  }
  return out;
}

export function dequantize(bytes: Uint8Array): Float32Array {
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out[i] = (b > 127 ? b - 256 : b) / 127;
  }
  return out;
}
