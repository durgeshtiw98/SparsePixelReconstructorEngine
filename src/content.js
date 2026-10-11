export const navigation = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "architecture", label: "Architecture", icon: "layers" },
  { id: "sampling", label: "Sampling", icon: "pixels" },
  { id: "reconstruction", label: "Reconstruction", icon: "spark" },
  { id: "model", label: "Learned model", icon: "brain", tag: "Optional" },
  { id: "evaluation", label: "Evaluation", icon: "chart" },
  { id: "roadmap", label: "Roadmap", icon: "route" },
];

export const phases = [
  {
    title: "Establish the reference",
    detail:
      "Build a SwiftUI app for iOS 17+, verify a Metal gradient on a physical iPhone, and time an expensive full-resolution scene.",
    gate: "The full shader is expensive enough to justify sparse shading.",
    label: "Foundation",
    weeks: "01",
    icon: "layers",
  },
  {
    title: "Build the Metal baselines",
    detail:
      "Implement NumPy references, compact sampling, indirect shading, and nearest, normalized convolution, and edge-aware Metal kernels.",
    gate: "NumPy / Metal difference < 1e-3, zero holes, quality and speed recorded.",
    label: "Core engine",
    weeks: "02",
    icon: "pixels",
  },
  {
    title: "Evaluate the learned model",
    detail:
      "Train a residual U-Net on DIV2K. Export to Core ML, then measure inference and texture / tensor copies separately.",
    gate: "≥ 1 dB above the best baseline, and faster than the full render. Otherwise drop the model.",
    label: "Optional ML",
    weeks: "03",
    icon: "brain",
  },
  {
    title: "Run the experiment matrix",
    detail:
      "Score 48 configurations on a fixed set of at least 50 held-out images. Benchmark 300 frames after 30 warm-up frames on the iPhone.",
    gate: "Every configuration is logged, including failures and thermal state.",
    label: "Evaluation",
    weeks: "04",
    icon: "chart",
  },
  {
    title: "Document the measured result",
    detail:
      "Repeat device runs three times. Publish CSVs, methodology, limitations, and resume statements drawn directly from logged results.",
    gate: "Every published number traces back to an unedited raw run.",
    label: "Write-up",
    weeks: "05",
    icon: "file",
  },
];

export const criteria = [
  [
    "Image quality at 40%",
    "Set after the first baseline run",
    "PSNR (all / unsampled), SSIM, LPIPS",
  ],
  [
    "GPU frame time",
    "Partial render + reconstruction < full render",
    "Median and p95 across 300 device frames",
  ],
  [
    "Held-out images",
    "At least 50; none used for training",
    "A fixed, committed split file",
  ],
  ["Sample ratios", "20%, 40%, and 60%", "A results table for each ratio"],
  [
    "Missing neighbors",
    "Zero holes for reported configurations",
    "An explicit hole counter",
  ],
  [
    "Evidence",
    "Every claim comes from a logged run",
    "Raw CSV files in results/",
  ],
];

export const risks = [
  [
    "A cheap scene shader",
    "Reconstruction may cost more than the shading it saves.",
    "Measure a full render before building the rest.",
  ],
  [
    "Thread divergence",
    "Early returns leave almost every SIMD group active.",
    "Compact sampled coordinates and dispatch indirectly.",
  ],
  [
    "Thermal throttling",
    "Device slowdown distorts comparisons.",
    "Cool down, log thermal state, compare within the same session.",
  ],
  [
    "Core ML transfers",
    "Texture / tensor copies may erase the gain.",
    "Time transfers separately; evaluate MPSGraph.",
  ],
  [
    "Test leakage",
    "Tuning against test images inflates quality.",
    "Choose settings on validation only; score test once.",
  ],
  [
    "Scope creep",
    "Temporal work delays the single-frame result.",
    "Finish the entire matrix before extending the engine.",
  ],
];

export const sampleCode = `kernel void make_mask_random(
    texture2d<uint, access::write> mask [[texture(0)]],
    device uint2* sampleList [[buffer(0)]],
    device atomic_uint* sampleCount [[buffer(1)]],
    constant SampleParams& p [[buffer(2)]],
    uint2 gid [[thread_position_in_grid]])
{
    if (gid.x >= mask.get_width() ||
        gid.y >= mask.get_height()) return;
    uint h = hash_u32(gid.x * 73856093u ^
                     gid.y * 19349663u ^ p.seed);
    bool keep = (float(h) / 4294967295.0) < p.ratio;
    mask.write(uint4(keep ? 1u : 0u), gid);
    if (keep) {
        uint i = atomic_fetch_add_explicit(
            sampleCount, 1u, memory_order_relaxed);
        sampleList[i] = gid;
    }
}`;

export const frameCode = `// Metal GPU time; do not substitute CPU wall time.
cmd.addCompletedHandler { command in
    let gpuMs = (command.gpuEndTime
               - command.gpuStartTime) * 1000.0
    metrics.record(frameGpuMs: gpuMs)
}

// Per frame:
// 1. Reset the sample counter.
// 2. Write full-resolution depth and normals.
// 3. Build mask + compact sample list.
// 4. Encode ceil(sampleCount / 64) dispatch groups.
// 5. Shade only the sampled coordinates.
// 6. Reconstruct; optionally refine with Core ML.
// 7. Present and log per-pass timing.`;

export const appTree = `app/SparseRender/
├── App/
│   ├── SparseRenderApp.swift
│   └── ContentView.swift
├── Engine/
│   ├── MetalContext.swift
│   ├── FrameGraph.swift
│   ├── GuidePass.swift
│   ├── SamplingPass.swift
│   ├── ShadePass.swift
│   ├── ReconstructPass.swift
│   ├── MLReconstructor.swift
│   └── Metrics.swift
├── Shaders/
│   ├── Sampling.metal
│   ├── Scene.metal
│   └── Reconstruct.metal
├── Resources/
│   ├── BlueNoise64.png
│   └── Reconstructor.mlpackage  (gated)
└── Bridge/                   (optional C++17)
    ├── EngineCore.hpp / .cpp
    └── EngineBridge.h / .mm`;

export const modelCode = `class SmallUNet(nn.Module):
    def __init__(self, c=(16, 32, 64)):
        super().__init__()
        self.e1 = block(7, c[0])
        self.e2 = block(c[0], c[1])
        self.e3 = block(c[1], c[2])
        self.pool = nn.MaxPool2d(2)
        self.up = nn.Upsample(scale_factor=2, mode='nearest')
        self.d2 = block(c[2] + c[1], c[1])
        self.d1 = block(c[1] + c[0], c[0])
        self.out = nn.Conv2d(c[0], 3, 1)

    def forward(self, sparse, mask, base):
        x = torch.cat([sparse, mask, base], dim=1)
        e1 = self.e1(x)
        e2 = self.e2(self.pool(e1))
        e3 = self.e3(self.pool(e2))
        d2 = self.d2(torch.cat([self.up(e3), e2], dim=1))
        d1 = self.d1(torch.cat([self.up(d2), e1], dim=1))
        pred = base + self.out(d1)
        return mask * sparse + (1 - mask) * pred`;

export const csvHeaders = [
  "sampling",
  "reconstruction",
  "ratio",
  "n_images",
  "psnr_all",
  "psnr_unsampled",
  "ssim",
  "lpips",
  "holes",
  "gpu_ms_median",
  "gpu_ms_p95",
  "full_render_ms_median",
  "speedup",
];
export function matrixRows(ratio) {
  return ["Random", "Lattice", "Blue noise", "Adaptive"].flatMap((sampling) =>
    [
      "Nearest",
      "Normalized convolution",
      "Edge-aware",
      "Edge-aware + U-Net",
    ].map((reconstruction) => ({
      sampling,
      reconstruction,
      ratio,
      status: reconstruction.includes("U-Net") ? "Gated" : "Not run",
    })),
  );
}
