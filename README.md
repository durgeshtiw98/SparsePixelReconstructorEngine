# Sparse — upload and rebuild

A small React + CSS image experiment. Upload, drop, or paste an image. Compare the original and rebuilt image, change how many pixels to keep, and download the result.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite.

## Controls

- Keep 20%, 40%, or 60% of the pixels.
- **Keep edges sharp**: existing two-pass edge-aware reconstruction.
- **Smooth blend**: existing normalized convolution.
- **Closest pixel**: existing nearest-neighbor reconstruction.
- View the rebuilt image, kept pixels, or a draggable before/after comparison.
- Download the rebuilt image as PNG.

Changes apply automatically. Reconstruction runs in a Web Worker so image processing does not block the controls. Uploaded files stay in the browser; no server receives them. Supported uploads: JPG, PNG, WebP, AVIF, GIF, up to 20 MB. Animated images are treated as a static image. Transparency is flattened onto white.

Large images are scaled to a maximum of 640 pixels on their longest side for this preview; proportions are preserved and smaller images are not enlarged. The download uses that same preview size. Original and working preview dimensions are displayed. This is JavaScript image reconstruction, with no trained model or native iPhone performance claims.

## Files

- `src/App.jsx` — two-panel interface, uploads, comparison, PNG download.
- `src/styles.css` — responsive styles.
- `src/engine.js` — existing sampling and reconstruction algorithms.
- `src/reconstruction.worker.js` — background processing.
- `public/scene.svg` — optional local example.

The original technical specification remains in `public/technical-spec.md`; its native Swift/Metal engine and optional U-Net are future work. The application now focuses on uploaded images.

## Verification

```sh
npm test
npm run build
npm run format:check
```

Optional Google Fonts use system fallbacks if unavailable.
