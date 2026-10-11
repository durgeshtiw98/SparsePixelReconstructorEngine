// A deterministic browser illustration. It does not measure Metal or Core ML.
export function hash(value) {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

export function createMask(
  width,
  height,
  ratio,
  pattern = "Random",
  seed = 42,
  pixels,
) {
  const size = width * height;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(ratio) ||
    ratio <= 0 ||
    ratio > 1
  )
    throw new RangeError("Invalid image size or sample ratio");
  const ranked = Array.from({ length: size }, (_, i) => {
    const x = i % width,
      y = Math.floor(i / width);
    const random =
      hash(Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ seed) / 4294967296;
    let priority = random;
    if (pattern === "Lattice")
      priority = (((x * 3 + y * 7) % 10) + random * 0.2) / 10.2;
    if (pattern === "Edge-adaptive" && pixels) {
      const q = i * 4,
        right = (x < width - 1 ? i + 1 : i) * 4,
        down = (y < height - 1 ? i + width : i) * 4;
      let gradient = 0;
      for (let c = 0; c < 3; c++)
        gradient +=
          Math.abs(pixels[q + c] - pixels[right + c]) +
          Math.abs(pixels[q + c] - pixels[down + c]);
      priority = random / (1 + gradient / 12);
    }
    return { i, priority };
  });
  ranked.sort((a, b) => a.priority - b.priority || a.i - b.i);
  const mask = new Uint8Array(size);
  for (let j = 0; j < Math.round(size * ratio); j++) mask[ranked[j].i] = 1;
  return mask;
}

export function reconstruct(
  source,
  mask,
  width,
  height,
  method = "Edge-aware",
  radius = 8,
) {
  if (source.length !== width * height * 4 || mask.length !== width * height)
    throw new RangeError("Image and mask dimensions must match");
  const output = new Uint8ClampedArray(source.length);
  const base =
    method === "Edge-aware"
      ? reconstruct(
          source,
          mask,
          width,
          height,
          "Normalized convolution",
          radius,
        ).pixels
      : null;
  const diameter = radius * 2 + 1;
  const spatial = new Float64Array(diameter * diameter);
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++)
      spatial[(dy + radius) * diameter + dx + radius] = Math.exp(
        -(dx * dx + dy * dy) / 11.52,
      );
  let holes = 0;
  for (let i = 0; i < mask.length; i++) {
    const offset = i * 4;
    output[offset + 3] = 255;
    if (mask[i]) {
      output.set(source.subarray(offset, offset + 4), offset);
      continue;
    }
    const x = i % width,
      y = Math.floor(i / width);
    let r = 0,
      g = 0,
      b = 0,
      total = 0,
      closest = Infinity,
      near = -1;
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (!mask[ni]) continue;
        const distance = dx * dx + dy * dy;
        if (method === "Nearest") {
          if (distance < closest) {
            closest = distance;
            near = ni * 4;
          }
          continue;
        }
        let weight = spatial[(dy + radius) * diameter + dx + radius];
        const n = ni * 4;
        if (base) {
          const luma =
            0.2126 * (base[offset] - base[n]) +
            0.7152 * (base[offset + 1] - base[n + 1]) +
            0.0722 * (base[offset + 2] - base[n + 2]);
          weight *= Math.exp((-luma * luma) / 800);
        }
        r += source[n] * weight;
        g += source[n + 1] * weight;
        b += source[n + 2] * weight;
        total += weight;
      }
    if (method === "Nearest" && near >= 0) {
      output.set(source.subarray(near, near + 4), offset);
    } else if (total > 1e-6) {
      output[offset] = r / total;
      output[offset + 1] = g / total;
      output[offset + 2] = b / total;
    } else {
      output[offset] = 255;
      output[offset + 2] = 255;
      holes++;
    }
  }
  return { pixels: output, holes };
}

export function score(source, prediction, mask) {
  let error = 0,
    unsampledError = 0,
    unsampled = 0;
  for (let i = 0; i < mask.length; i++) {
    for (let c = 0; c < 3; c++) {
      const e = (source[i * 4 + c] - prediction[i * 4 + c]) ** 2;
      error += e;
      if (!mask[i]) unsampledError += e;
    }
    if (!mask[i]) unsampled++;
  }
  const db = (mse) => (mse === 0 ? Infinity : 10 * Math.log10(255 ** 2 / mse));
  return {
    psnr: db(error / (mask.length * 3)),
    psnrUnsampled: unsampled ? db(unsampledError / (unsampled * 3)) : null,
  };
}
