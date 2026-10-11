import { createMask, reconstruct } from "./engine.js";

self.onmessage = ({ data }) => {
  try {
    const { pixels, width, height, ratio, method } = data;
    const mask = createMask(width, height, ratio, "Random", 42);
    const { pixels: reconstructed, holes } = reconstruct(
      pixels,
      mask,
      width,
      height,
      method,
    );
    const sparse = new Uint8ClampedArray(pixels.length);
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) sparse.set(pixels.subarray(i * 4, i * 4 + 4), i * 4);
      else sparse.set([35, 31, 43, 255], i * 4);
    }
    self.postMessage({ reconstructed, sparse, holes }, [
      reconstructed.buffer,
      sparse.buffer,
    ]);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
