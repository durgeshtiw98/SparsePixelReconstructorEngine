import test from "node:test";
import assert from "node:assert/strict";
import { createMask, reconstruct, score } from "./engine.js";

test("every pattern respects the exact target count and seed determinism", () => {
  const width = 20,
    height = 15;
  const pixels = Uint8ClampedArray.from(
    { length: width * height * 4 },
    (_, i) => i % 256,
  );
  for (const ratio of [0.2, 0.4, 0.6])
    for (const pattern of ["Random", "Lattice", "Edge-adaptive"]) {
      const mask = createMask(width, height, ratio, pattern, 42, pixels);
      assert.equal(
        mask.reduce((a, b) => a + b, 0),
        Math.round(width * height * ratio),
      );
      assert.deepEqual(
        mask,
        createMask(width, height, ratio, pattern, 42, pixels),
      );
    }
  assert.notDeepEqual(
    createMask(width, height, 0.4, "Random", 42),
    createMask(width, height, 0.4, "Random", 43),
  );
});

test("each baseline preserves samples and reconstructs a constant field exactly", () => {
  const width = 9,
    height = 7;
  const source = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++)
    source.set([63, 127, 191, 255], i * 4);
  const mask = createMask(width, height, 0.4);
  for (const method of ["Nearest", "Normalized convolution", "Edge-aware"]) {
    const { pixels, holes } = reconstruct(source, mask, width, height, method);
    assert.equal(holes, 0);
    assert.deepEqual(pixels, source);
  }
});

test("sampled colors are preserved on nonconstant images for every baseline", () => {
  const width = 8,
    height = 8;
  const source = Uint8ClampedArray.from(
    { length: width * height * 4 },
    (_, i) => (i % 4 === 3 ? 255 : (i * 17) % 256),
  );
  const mask = createMask(width, height, 0.2);
  for (const method of ["Nearest", "Normalized convolution", "Edge-aware"]) {
    const { pixels } = reconstruct(source, mask, width, height, method);
    for (let i = 0; i < mask.length; i++)
      if (mask[i])
        assert.deepEqual(
          pixels.slice(i * 4, i * 4 + 4),
          source.slice(i * 4, i * 4 + 4),
        );
  }
});

test("holes are counted and made explicitly magenta", () => {
  const source = new Uint8ClampedArray(4 * 4 * 4);
  const mask = new Uint8Array(16);
  for (const method of ["Nearest", "Normalized convolution", "Edge-aware"]) {
    const { pixels, holes } = reconstruct(source, mask, 4, 4, method, 1);
    assert.equal(holes, 16);
    for (let i = 0; i < 16; i++)
      assert.deepEqual(
        Array.from(pixels.slice(i * 4, i * 4 + 4)),
        [255, 0, 255, 255],
      );
  }
});

test("PSNR reports all-pixel and unsampled error separately", () => {
  const source = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]);
  const prediction = new Uint8ClampedArray([0, 0, 0, 255, 10, 10, 10, 255]);
  const result = score(source, prediction, new Uint8Array([1, 0]));
  assert.ok(Math.abs(result.psnr - 10 * Math.log10(255 ** 2 / 50)) < 1e-10);
  assert.ok(
    Math.abs(result.psnrUnsampled - 10 * Math.log10(255 ** 2 / 100)) < 1e-10,
  );
  assert.equal(score(source, source, new Uint8Array([1, 1])).psnr, Infinity);
  assert.equal(
    score(source, source, new Uint8Array([1, 1])).psnrUnsampled,
    null,
  );
});

test("invalid boundary inputs are rejected", () => {
  assert.throws(() => createMask(0, 3, 0.4), RangeError);
  assert.throws(() => createMask(3, 3, NaN), RangeError);
  assert.throws(() => createMask(3, 3, 1.1), RangeError);
  assert.throws(
    () => reconstruct(new Uint8ClampedArray(4), new Uint8Array(2), 1, 1),
    RangeError,
  );
});
