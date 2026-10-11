import React, { useEffect, useRef, useState } from "react";

const methods = [
  { value: "Edge-aware", label: "Keep edges sharp" },
  { value: "Normalized convolution", label: "Smooth blend" },
  { value: "Nearest", label: "Closest pixel" },
];

function Icon({ name, size = 20 }) {
  const paths = {
    upload: "M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6",
    image: "M3 3h18v18H3zM3 16l6-6 5 5 3-3 4 4M15 7h.01",
    arrow: "M4 12h16m-5-5 5 5-5 5",
    download: "M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5",
    close: "m6 6 12 12M18 6 6 18",
    lock: "M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

async function decodeImage(url, name) {
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    throw new Error(
      "That image could not be opened. Try a JPG, PNG or WebP file.",
    );
  }
  if (
    !image.naturalWidth ||
    !image.naturalHeight ||
    image.naturalWidth * image.naturalHeight > 50_000_000
  ) {
    throw new Error(
      "That image is too large. Choose an image under 50 megapixels.",
    );
  }
  const scale = Math.min(
    1,
    640 / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return {
    name,
    width,
    height,
    originalWidth: image.naturalWidth,
    originalHeight: image.naturalHeight,
    pixels: context.getImageData(0, 0, width, height).data,
    previewUrl: canvas.toDataURL("image/png"),
  };
}

function ResultCanvas({ pixels, width, height, label }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!pixels) return;
    const canvas = ref.current;
    canvas.width = width;
    canvas.height = height;
    canvas
      .getContext("2d")
      .putImageData(new ImageData(pixels, width, height), 0, 0);
  }, [pixels, width, height]);
  return <canvas ref={ref} aria-label={label} role="img" />;
}

export default function App() {
  const [image, setImage] = useState(null);
  const [ratio, setRatio] = useState(40);
  const [method, setMethod] = useState("Edge-aware");
  const [result, setResult] = useState(null);
  const [view, setView] = useState("rebuilt");
  const [split, setSplit] = useState(50);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const inputRef = useRef(null),
    uploadId = useRef(0),
    uploadRef = useRef(null),
    activeImage = useRef(null);
  activeImage.current = image;

  useEffect(() => {
    document.title = "Sparse — Upload & rebuild your image";
    return () => {
      uploadId.current++;
    };
  }, []);

  async function loadSource(url, name, owned = false) {
    const id = ++uploadId.current;
    setUploading(true);
    setError("");
    setDragging(false);
    try {
      const next = await decodeImage(url, name);
      if (id !== uploadId.current) return;
      setImage({ ...next, id });
      setResult(null);
      setView("rebuilt");
      setDownloadError("");
    } catch (e) {
      if (id === uploadId.current) setError(e.message);
    } finally {
      if (owned) URL.revokeObjectURL(url);
      if (id === uploadId.current) setUploading(false);
    }
  }

  function upload(file) {
    if (!file) return;
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/avif",
      "image/gif",
    ];
    if (!allowed.includes(file.type)) {
      setError("Choose a JPG, PNG, WebP, AVIF or GIF image.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError("Choose an image smaller than 20 MB.");
      return;
    }
    loadSource(URL.createObjectURL(file), file.name, true);
  }
  uploadRef.current = upload;

  useEffect(() => {
    function onPaste(event) {
      const file = Array.from(event.clipboardData?.files || []).find((file) =>
        file.type.startsWith("image/"),
      );
      if (file) {
        event.preventDefault();
        uploadRef.current(file);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  useEffect(() => {
    if (!image) {
      setResult(null);
      setProcessing(false);
      return;
    }
    setProcessing(true);
    setDownloadError("");
    let alive = true,
      worker;
    const timer = setTimeout(() => {
      try {
        worker = new Worker(
          new URL("./reconstruction.worker.js", import.meta.url),
          { type: "module" },
        );
        worker.onmessage = (event) => {
          if (!alive) return;
          if (event.data.error) setError(event.data.error);
          else setResult({ ...event.data, imageId: image.id, ratio, method });
          setProcessing(false);
          worker.terminate();
        };
        worker.onerror = () => {
          if (alive) {
            setError(
              "The image could not be rebuilt. Try a smaller image or another method.",
            );
            setProcessing(false);
          }
          worker.terminate();
        };
        worker.postMessage({
          pixels: image.pixels,
          width: image.width,
          height: image.height,
          ratio: ratio / 100,
          method,
        });
      } catch {
        if (alive) {
          setError("The image could not be rebuilt. Reload and try again.");
          setProcessing(false);
        }
      }
    }, 120);
    return () => {
      alive = false;
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [image, ratio, method]);

  const ready = Boolean(
    image &&
    result &&
    result.imageId === image.id &&
    result.ratio === ratio &&
    result.method === method &&
    !processing &&
    !uploading,
  );
  const pending = image && !ready && (processing || uploading);

  function clearImage() {
    uploadId.current++;
    setImage(null);
    setResult(null);
    setUploading(false);
    setError("");
    setDownloadError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function download() {
    if (!ready) return;
    setDownloadError("");
    const sourceId = image.id,
      currentResult = result;
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    canvas
      .getContext("2d")
      .putImageData(
        new ImageData(currentResult.reconstructed, image.width, image.height),
        0,
        0,
      );
    const name = image.name.replace(/\.[^.]+$/, "");
    canvas.toBlob((blob) => {
      if (activeImage.current?.id !== sourceId) return;
      if (!blob) {
        setDownloadError(
          "The download could not be created. Please try again.",
        );
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${name}-rebuilt-${currentResult.ratio}pct.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  }

  return (
    <div className="app">
      <header className="header">
        <a href="#" className="brand" aria-label="Sparse home">
          <span className="brand-mark" aria-hidden="true">
            {Array.from({ length: 9 }, (_, i) => (
              <i key={i} />
            ))}
          </span>
          sparse<span>.</span>
        </a>
        <span className="privacy">
          <Icon name="lock" size={14} />
          Images stay on your device
        </span>
      </header>
      <main>
        <div className="intro">
          <span className="eyebrow">A LITTLE LESS. A LITTLE MAGIC.</span>
          <h1>
            Upload an image. <span>See the difference.</span>
          </h1>
          <p>Keep some pixels. Let the algorithm fill in the rest.</p>
        </div>
        <input
          type="file"
          ref={inputRef}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose an image file"
          accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
          onChange={(event) => {
            upload(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        {error && (
          <div className="error" role="alert">
            {error}
            <button aria-label="Dismiss message" onClick={() => setError("")}>
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        <div className="workspace">
          <section
            className={`panel original-panel ${dragging ? "is-dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              upload(event.dataTransfer.files?.[0]);
            }}
            aria-labelledby="original-heading"
          >
            <div className="panel-heading">
              <div>
                <span className="step">01</span>
                <h2 id="original-heading">Your image</h2>
              </div>
              {image && (
                <div className="image-actions">
                  <button onClick={() => inputRef.current.click()}>
                    Change image
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Remove image"
                    onClick={clearImage}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
              )}
            </div>
            {image ? (
              <div className="image-stage">
                <img src={image.previewUrl} alt={`Original: ${image.name}`} />
                {uploading && (
                  <div className="loading-overlay">
                    <span className="spinner" />
                    Opening image…
                  </div>
                )}
                {dragging && (
                  <div className="drop-overlay">
                    <Icon name="upload" />
                    Drop to replace your image
                  </div>
                )}
              </div>
            ) : (
              <div className="upload-stage">
                <button
                  className={`drop-zone ${dragging ? "hovered" : ""}`}
                  onClick={() => inputRef.current.click()}
                  disabled={uploading}
                >
                  <span className="upload-icon">
                    <Icon name="upload" size={27} />
                  </span>
                  <strong>
                    {uploading
                      ? "Opening your image…"
                      : dragging
                        ? "Drop your image here"
                        : "Drop an image here"}
                  </strong>
                  <span className="drop-description">
                    or click to choose a file
                  </span>
                  <span className="choose-button">
                    <Icon name="image" size={16} />
                    Choose image
                  </span>
                  <span className="file-hint">
                    JPG, PNG, WebP & more · up to 20 MB
                  </span>
                </button>
                <button
                  className="example-button"
                  onClick={() => loadSource("/scene.svg", "Example image")}
                  disabled={uploading}
                >
                  Just trying it out?{" "}
                  <span>
                    Use an example
                    <Icon name="arrow" size={14} />
                  </span>
                </button>
              </div>
            )}
            <div className="panel-footer">
              {image ? (
                <>
                  <span className="file-name" title={image.name}>
                    {image.name}
                  </span>
                  <span>
                    {image.originalWidth} × {image.originalHeight}
                  </span>
                </>
              ) : (
                <>
                  <Icon name="lock" size={13} />
                  <span>
                    No upload to a server. You can paste an image, too.
                  </span>
                </>
              )}
            </div>
          </section>
          <section
            className="panel result-panel"
            aria-labelledby="result-heading"
            aria-busy={Boolean(pending)}
          >
            <div className="panel-heading">
              <div>
                <span className="step purple">02</span>
                <h2 id="result-heading">Rebuilt image</h2>
              </div>
              <span
                className={`status ${ready ? "done" : ""}`}
                aria-live="polite"
              >
                <i />
                {pending
                  ? "Working…"
                  : ready
                    ? "Ready to compare"
                    : "Waiting for your image"}
              </span>
            </div>
            {image ? (
              <>
                <div className="image-stage result-stage">
                  {result && (
                    <div className="result-image">
                      <ResultCanvas
                        pixels={
                          view === "sampled"
                            ? result.sparse
                            : result.reconstructed
                        }
                        width={image.width}
                        height={image.height}
                        label={
                          view === "sampled"
                            ? "Pixels kept; the removed pixels are dark"
                            : "Image rebuilt from the kept pixels"
                        }
                      />
                      {view === "compare" && (
                        <>
                          <div
                            className="comparison-original"
                            style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
                          >
                            <img
                              src={image.previewUrl}
                              alt="Original side of comparison"
                            />
                          </div>
                          <div
                            className="comparison-line"
                            style={{ left: `${split}%` }}
                          >
                            <span>↔</span>
                          </div>
                          <span className="compare-label original-label">
                            Original
                          </span>
                          <span className="compare-label rebuilt-label">
                            Rebuilt
                          </span>
                          <input
                            className="comparison-slider"
                            type="range"
                            min="0"
                            max="100"
                            value={split}
                            onChange={(event) =>
                              setSplit(Number(event.target.value))
                            }
                            aria-label="Before and after comparison"
                          />
                        </>
                      )}
                    </div>
                  )}
                  {pending && (
                    <div className="loading-overlay">
                      <span className="spinner" />
                      Filling in the missing pixels…
                    </div>
                  )}
                  {!pending && !result && (
                    <div className="result-error">
                      Try another image or method to see a result.
                    </div>
                  )}
                </div>
                <div className="result-toolbar">
                  <div className="view-tabs" aria-label="Result view">
                    {[
                      { id: "rebuilt", label: "Rebuilt" },
                      { id: "sampled", label: "Pixels kept" },
                      { id: "compare", label: "Compare" },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        className={view === tab.id ? "active" : ""}
                        aria-pressed={view === tab.id}
                        onClick={() => setView(tab.id)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <button
                    className="download-button"
                    onClick={download}
                    disabled={!ready}
                    aria-label="Download rebuilt image"
                  >
                    <Icon name="download" size={16} />
                    <span>Download</span>
                  </button>
                </div>
              </>
            ) : (
              <div className="result-empty">
                <span className="empty-art" aria-hidden="true">
                  {Array.from({ length: 25 }, (_, i) => (
                    <i key={i} />
                  ))}
                </span>
                <h3>Your result goes here</h3>
                <p>
                  Add an image on the left.
                  <br />
                  We’ll rebuild it using fewer pixels.
                </p>
                <span className="empty-arrow">
                  <Icon name="arrow" size={18} />
                </span>
              </div>
            )}
            <div className="panel-footer result-footer">
              {image ? (
                <>
                  <span>
                    <i className="color-dot" />
                    {ratio}% kept <i className="color-dot pale" />
                    {100 - ratio}% filled in
                  </span>
                  <span>
                    {image.width} × {image.height} preview
                  </span>
                </>
              ) : (
                <span>You choose how many pixels to keep.</span>
              )}
            </div>
          </section>
        </div>
        <section
          className="controls"
          aria-label="Image reconstruction settings"
        >
          <div className="ratio-control">
            <label htmlFor="ratio">
              How many pixels should we keep?<strong>{ratio}%</strong>
            </label>
            <input
              id="ratio"
              type="range"
              min="20"
              max="60"
              step="20"
              value={ratio}
              onChange={(event) => {
                setRatio(Number(event.target.value));
                setError("");
              }}
              style={{ "--fill": `${((ratio - 20) / 40) * 100}%` }}
            />
            <div className="range-labels">
              <span>
                20% <small>More to rebuild</small>
              </span>
              <span>40%</span>
              <span>
                60% <small>More detail kept</small>
              </span>
            </div>
          </div>
          <div className="control-divider" />
          <div className="method-control">
            <label htmlFor="method">How should we fill the gaps?</label>
            <select
              id="method"
              value={method}
              onChange={(event) => {
                setMethod(event.target.value);
                setError("");
              }}
            >
              {methods.map((item) => (
                <option value={item.value} key={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <span>Changes apply automatically.</span>
          </div>
        </section>
        {ready && result.holes > 0 && (
          <p className="hole-note" role="status">
            {result.holes} pixels had no nearby sample and are shown in pink.
            Try keeping more pixels.
          </p>
        )}
        {downloadError && (
          <p className="error" role="alert">
            {downloadError}
          </p>
        )}
        <p className="bottom-note">
          {image &&
          (image.width < image.originalWidth ||
            image.height < image.originalHeight)
            ? `Large images are resized for this preview. Your download uses the ${image.width} × ${image.height} preview size.`
            : "A simple image experiment. No AI model — just the existing reconstruction algorithms."}
        </p>
      </main>
      <footer>
        <span>Fewer pixels. Same bigger picture.</span>
        <span>Made to explore, not overcomplicate.</span>
      </footer>
    </div>
  );
}
