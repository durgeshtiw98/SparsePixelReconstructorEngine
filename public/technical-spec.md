# Sparse Pixel Reconstruction Engine

Technical design · October 8, 2026

## The claim to prove

At a 40% sample ratio, reconstruct the missing 60% at measured PSNR, SSIM, and LPIPS, while partial rendering plus all reconstruction overhead is faster than a full render on a physical iPhone. If it is slower, report that result. This React application is an interactive design companion, not the native engine.

## Scope

- Static images first, then a live Metal scene on a physical iPhone.
- Random, checkerboard/lattice, blue-noise, and edge-adaptive sampling.
- Nearest, normalized convolution (bilinear-like), cross-bilateral edge-aware, and optional residual U-Net reconstruction.
- Report 20%, 40%, and 60% ratios for every configuration.
- At least 50 held-out images and a fixed, committed split file.
- No temporal reconstruction, Android/Vulkan, or unmeasured energy/battery claims.

## Architecture

Offline: Python 3.11, PyTorch training → coremltools export → gated .mlpackage in app bundle.

On device: SwiftUI → reset sample counter → full-resolution guide (depth/normals) → mask and compact coordinate list → indirect dispatch arguments → expensive sparse shade pass → Metal reconstruction → optional Core ML refinement → present and record GPU timing.

The expensive shader runs only on the compact sample list. An early return in a full-grid dispatch does not imply proportional savings because SIMD groups remain active.

## Setup

1. Current stable Xcode, Swift 5.9+, SwiftUI app targeting iOS 17+; run on physical iPhone.
2. Display a gradient from a Metal compute kernel.
3. Create a Python virtual environment. Install torch, torchvision, coremltools, numpy, opencv-python, scipy, scikit-image, torchmetrics, lpips, pandas, matplotlib.
4. Organize app/, research/, results/.
5. Optional C++17 metal-cpp core through a narrow Objective-C++ bridge only after the Swift path is measured.

## Data

DIV2K training: 800 images, random 256 × 256 patches. DIV2K validation: 100 images for checkpoints and parameter tuning. Final test: Kodak 24 + Set14 14 + at least 12 additional independent images. Review licenses before publishing. Do not tune on the test set.

Device scene: use a genuinely expensive shader, such as an SDF ray marcher with soft shadows and lighting. Save full-resolution ground-truth images at fixed camera positions. Commit camera paths and seeds.

## Sampling

Random: reproducible unsigned 32-bit pixel hash and ratio threshold. Implement the same hash in NumPy and MSL; NumPy default_rng is not equivalent.

Checkerboard: exactly 50%; use a lattice for other ratios. Blue noise: shared tiled 64 × 64 texture with values in [0, 1], thresholded at each ratio.

Adaptive: cheap 1/8-resolution guide; gradients per 8 × 8 tile; bounded budgets with at least one sample per tile; positions from blue noise; reconcile the total budget to the target exactly. Include pre-pass cost.

Compaction: atomic counter appends coordinates; reset to zero before each frame. List order is immaterial. An indirect dispatch runs ceil(count / 64) groups, with the shader guarding any final excess threads.

## Metal reconstruction

- Nearest: closest sampled neighbor; cheapest, blocky.
- Normalized convolution: Gaussian weighted sampled neighbors within radius R.
- Edge-aware: add a range weight from depth/normals; for photos, guide with pass-1 luminance.

Spatial weight: exp(-(dx² + dy²) / (2σs²)). Range weight: exp(-(g(q) - g(p))² / (2σr²)). Copy sampled pixels unchanged. If no sampled neighbor exists, increment holes and write magenta. Require zero holes in reported results. Tune R, σs, σr on validation only.

Implement NumPy reference methods first. Compare Metal float outputs against them with maximum absolute difference below 1e-3. Optimize after parity, and repeat parity checks after each change.

## Optional residual U-Net

Inputs: 7 channels (sparse RGB, mask, baseline RGB). Output: RGB residual, added to baseline. Copy samples unchanged after inference.

Feature channels: 16/32/64, with 3 × 3 convolutions, ReLU, max pooling, nearest upsampling, and concatenation. The supplied skeleton has three feature levels and two pooling steps. Target roughly 0.3M parameters; count the actual architecture.

Training: random and blue-noise masks, ratio drawn from 0.2–0.6; weighted L1 (2× on unsampled pixels) plus small gradient loss; Adam 1e-3, cosine decay, batch size 16, random 256 × 256 patches. Select checkpoint using validation PSNR only.

Export fixed 512 × 512 inputs as FP16 mlprogram for iOS 17. Evaluate INT8 weights separately. Measure quality and inference latency changes. Measure both Metal/Core ML transfer directions. Consider MPSGraph if transfers dominate.

Gate: keep only if held-out PSNR is at least 1 dB above the best baseline AND total native frame time remains below full rendering. Otherwise ship Metal-only.

## Native app modules

MetalContext: device, queue, library, pipelines.
FrameGraph: passes, textures/buffers, memory reuse.
GuidePass: full-resolution geometry guides.
SamplingPass: mask, compact list, indirect arguments.
ShadePass: expensive shading of listed pixels.
ReconstructPass: native baselines.
MLReconstructor: optional model.
Metrics: GPU time, holes, loaded-reference quality, CSV export.
ContentView: method/ratio controls, full-render toggle, metrics overlay.

## Evaluation

48 configurations: 4 patterns × 4 methods × 3 ratios, each on the same at-least-50-image set. Report PSNR for all pixels and unsampled pixels separately, SSIM, LPIPS, and holes. PSNR = 10 log10(255² / MSE) for 8-bit data. Use data_range=1 for normalized floating-point data.

Device protocol: Release build on physical iPhone; Low Power Mode off; charger or battery >50%; thermal state nominal; fixed camera, resolution, brightness, seeds; 30 warm-up frames and 300 logged frames; GPU median/p95 from gpuStartTime/gpuEndTime; per-pass Metal System Trace; thermal state at start/end; repeat three times after cool-down; full render in same session.

Log schema:
sampling,reconstruction,ratio,n_images,psnr_all,psnr_unsampled,ssim,lpips,holes,gpu_ms_median,gpu_ms_p95,full_render_ms_median,speedup

Save raw generated logs under results/matrix.csv. Do not edit results by hand. A blank CSV template is not a measured run.

## Roadmap

1. Foundation: device app, gradient, expensive reference shader; gate on real shading cost.
2. Core: NumPy baselines, Metal parity, compaction, reconstruction; gate on zero holes and recorded quality/speed.
3. Optional ML: train/export/measure; drop if either quality or speed gate fails.
4. Matrix: fixed held-out evaluation and repeated device benchmarks.
5. Write-up: limitations, raw logs, reproducibility, evidence-backed resume.

Suggested effort: 10–15 hours per week; adjust timing while preserving order.

## Risks and claims

Measure shader cost first. Avoid divergent full-grid shading. Control thermal drift. Include guide, compaction, reconstruction, ML, and copies in total time. Prevent leakage with fixed splits. Defer temporal scope.

Resume statements use only logged values, with image count, ratio, iPhone model, and iOS version available. Describe the model as trained on public images and exported to Core ML. Document a model rejection instead of hiding it. Do not claim device speed, battery savings, SSIM, or LPIPS from this browser demo.
