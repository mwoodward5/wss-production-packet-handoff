import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload, Download, Send, RotateCcw, Frame as FrameIcon, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { LOOKS, LookId, applyLook, letterboxFor } from "@/lib/looks";

const MAX_PREVIEW = 1100; // px on long edge for live preview
const EXPORT_MAX = 2400;  // px on long edge for export

interface ProcessedState {
  src: ImageData | null;        // downsized for preview perf
  fullSrc: ImageData | null;    // export-resolution
  previewOut: ImageData | null;
  fileName: string;
}

function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function imageToImageData(img: HTMLImageElement, maxEdge: number) {
  const long = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = long > maxEdge ? maxEdge / long : 1;
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export default function FrameStudio() {
  const [state, setState] = useState<ProcessedState>({ src: null, fullSrc: null, previewOut: null, fileName: "" });
  const [look, setLook] = useState<LookId>("atlanta-gold-hour");
  const [intensity, setIntensity] = useState(0.85);
  const [withFrame, setWithFrame] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const lookDef = useMemo(() => LOOKS.find(l => l.id === look)!, [look]);

  const onFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setBusy(true);
    try {
      const img = await loadImageFile(file);
      const preview = imageToImageData(img, MAX_PREVIEW);
      const full = imageToImageData(img, EXPORT_MAX);
      setState({ src: preview, fullSrc: full, previewOut: preview, fileName: file.name });
    } finally {
      setBusy(false);
    }
  }, []);

  // re-process preview when look or intensity changes
  useEffect(() => {
    if (!state.src) return;
    let cancelled = false;
    // throttle with rAF
    const id = requestAnimationFrame(() => {
      if (cancelled) return;
      const out = applyLook(state.src!, look, intensity);
      setState((s) => ({ ...s, previewOut: out }));
    });
    return () => { cancelled = true; cancelAnimationFrame(id); };
  }, [look, intensity, state.src]);

  // paint preview to canvas
  useEffect(() => {
    if (!state.previewOut || !previewCanvasRef.current) return;
    const c = previewCanvasRef.current;
    const out = state.previewOut;
    c.width = out.width; c.height = out.height;
    const ctx = c.getContext("2d")!;
    ctx.putImageData(out, 0, 0);

    // letterbox bars
    const lb = letterboxFor(look);
    if (lb > 0) {
      const targetH = out.width / lb;
      if (targetH < out.height) {
        const barH = (out.height - targetH) / 2;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, out.width, barH);
        ctx.fillRect(0, out.height - barH, out.width, barH);
      }
    }
  }, [state.previewOut, look]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };

  const reset = () => setState({ src: null, fullSrc: null, previewOut: null, fileName: "" });

  const exportPng = () => {
    if (!state.fullSrc) return;
    setBusy(true);
    requestAnimationFrame(() => {
      try {
        const graded = applyLook(state.fullSrc!, look, intensity);
        const lb = letterboxFor(look);
        const c = document.createElement("canvas");
        c.width = graded.width;
        c.height = graded.height;
        const ctx = c.getContext("2d")!;
        ctx.putImageData(graded, 0, 0);

        // letterbox
        if (lb > 0) {
          const targetH = graded.width / lb;
          if (targetH < graded.height) {
            const barH = (graded.height - targetH) / 2;
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, graded.width, barH);
            ctx.fillRect(0, graded.height - barH, graded.width, barH);
          }
        }

        if (withFrame) drawFrameChrome(ctx, c.width, c.height, lookDef.name, lookDef.meta);
        drawWatermark(ctx, c.width, c.height);

        const a = document.createElement("a");
        a.download = `xphotography-${look}-${Date.now()}.png`;
        a.href = c.toDataURL("image/png");
        a.click();
      } finally {
        setBusy(false);
      }
    });
  };

  const sendToXavier = () => {
    const subject = encodeURIComponent(`Frame Studio — ${lookDef.name}`);
    const body = encodeURIComponent(
      `Hi Xavier,\n\nI just remastered a photo in your Frame Studio using the "${lookDef.name}" look (${Math.round(intensity*100)}% intensity).\n\nI'd love to talk about a real session.\n\nName:\nPhone:\nWhat I'm thinking about:\n\n— sent from xphotography studio`
    );
    window.location.href = `mailto:xphotography20@gmail.com?subject=${subject}&body=${body}`;
  };

  return (
    <div className="grid lg:grid-cols-12 gap-8 lg:gap-12">
      {/* CANVAS */}
      <div className="lg:col-span-8">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`relative aspect-[4/3] bg-paper-soft border ${dragging ? "border-molten" : "border-ivory/15"} transition-colors overflow-hidden lightframe`}
        >
          <span className="frame-corner tl" />
          <span className="frame-corner tr" />
          <span className="frame-corner bl" />
          <span className="frame-corner br" />

          {state.previewOut ? (
            <canvas
              ref={previewCanvasRef}
              className="absolute inset-0 w-full h-full object-contain bg-black"
              aria-label={`Preview with ${lookDef.name}`}
            />
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-ivory/70 hover:text-ivory transition"
            >
              <Upload className="w-10 h-10 text-molten" />
              <div className="font-display text-3xl text-ivory">Drop a photo here</div>
              <div className="label-eyebrow text-ivory/50">JPG · PNG · HEIC · up to 25MB</div>
              <div className="mt-4 px-6 py-3 bg-molten text-ink label-eyebrow">Choose a file</div>
            </button>
          )}

          {busy && (
            <div className="absolute inset-0 bg-paper/60 flex items-center justify-center backdrop-blur-sm">
              <div className="label-eyebrow text-molten animate-pulse">Processing…</div>
            </div>
          )}

          <div className="absolute top-4 left-4 label-eyebrow text-ivory/70 bg-paper/60 px-3 py-1 backdrop-blur-sm">
            {lookDef.meta}
          </div>
          {state.fileName && (
            <div className="absolute bottom-4 right-4 label-eyebrow text-ivory/60 bg-paper/60 px-3 py-1 backdrop-blur-sm font-mono">
              {state.fileName}
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
        />

        <p className="mt-4 label-eyebrow text-ivory/50">Your photo never leaves your device.</p>
      </div>

      {/* CONTROLS */}
      <div className="lg:col-span-4 space-y-8">
        <div>
          <div className="label-eyebrow text-molten mb-4">01 · Choose a look</div>
          <div className="grid grid-cols-2 gap-2">
            {LOOKS.map((l) => (
              <button
                key={l.id}
                onClick={() => setLook(l.id)}
                className={`text-left px-3 py-3 border transition-colors ${
                  look === l.id ? "border-molten bg-molten/10 text-ivory" : "border-ivory/15 text-ivory/70 hover:border-ivory/40"
                }`}
              >
                <div className="font-display text-base leading-tight">{l.name}</div>
                <div className="font-mono text-[0.6rem] text-ivory/50 mt-1">{l.meta}</div>
              </button>
            ))}
          </div>
          <p className="mt-3 text-ivory/60 text-sm leading-snug">{lookDef.tagline}</p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="label-eyebrow text-molten">02 · Intensity</div>
            <div className="font-mono text-xs text-ivory/60">{Math.round(intensity * 100)}%</div>
          </div>
          <input
            type="range" min={0} max={100} value={Math.round(intensity * 100)}
            onChange={(e) => setIntensity(Number(e.target.value) / 100)}
            className="w-full accent-molten"
          />
        </div>

        <div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox" checked={withFrame}
              onChange={(e) => setWithFrame(e.target.checked)}
              className="accent-molten w-4 h-4"
            />
            <span className="label-eyebrow text-ivory/80 inline-flex items-center gap-2">
              <FrameIcon className="w-3.5 h-3.5" /> Wrap export in XJ frame chrome
            </span>
          </label>
        </div>

        <div className="space-y-3 pt-2 border-t border-ivory/10">
          <button
            onClick={exportPng}
            disabled={!state.fullSrc || busy}
            className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 bg-molten text-ink label-eyebrow hover:bg-ivory transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" /> Export PNG
          </button>
          <button
            onClick={sendToXavier}
            disabled={!state.fullSrc}
            className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 border border-ivory/30 text-ivory label-eyebrow hover:border-molten hover:text-molten transition disabled:opacity-30"
          >
            <Send className="w-4 h-4" /> Send to Xavier
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 border border-ivory/15 text-ivory/70 label-eyebrow hover:text-ivory hover:border-ivory/40 transition"
            >
              <Sparkles className="w-3.5 h-3.5" /> New photo
            </button>
            <button
              onClick={reset}
              disabled={!state.src}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 border border-ivory/15 text-ivory/70 label-eyebrow hover:text-ivory hover:border-ivory/40 transition disabled:opacity-30"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset
            </button>
          </div>
        </div>

        <p className="text-ivory/55 text-xs leading-relaxed pt-2 border-t border-ivory/10">
          Want the real thing? <Link to="/contact" className="text-molten underline underline-offset-4">Reserve a session with Xavier</Link>.
        </p>
      </div>
    </div>
  );
}

// ---------- export chrome ----------
function drawFrameChrome(ctx: CanvasRenderingContext2D, w: number, h: number, lookName: string, meta: string) {
  const pad = Math.round(Math.min(w, h) * 0.018);
  const len = Math.round(Math.min(w, h) * 0.05);
  ctx.strokeStyle = "rgba(232,210,150,0.85)";
  ctx.lineWidth = Math.max(1, Math.round(Math.min(w, h) * 0.0018));
  // tl
  ctx.beginPath(); ctx.moveTo(pad, pad + len); ctx.lineTo(pad, pad); ctx.lineTo(pad + len, pad); ctx.stroke();
  // tr
  ctx.beginPath(); ctx.moveTo(w - pad - len, pad); ctx.lineTo(w - pad, pad); ctx.lineTo(w - pad, pad + len); ctx.stroke();
  // bl
  ctx.beginPath(); ctx.moveTo(pad, h - pad - len); ctx.lineTo(pad, h - pad); ctx.lineTo(pad + len, h - pad); ctx.stroke();
  // br
  ctx.beginPath(); ctx.moveTo(w - pad - len, h - pad); ctx.lineTo(w - pad, h - pad); ctx.lineTo(w - pad, h - pad - len); ctx.stroke();

  // top-left meta
  const fontSize = Math.max(10, Math.round(Math.min(w, h) * 0.012));
  ctx.fillStyle = "rgba(247,236,210,0.85)";
  ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
  ctx.textBaseline = "top";
  ctx.fillText(meta.toUpperCase(), pad + len + 8, pad + 2);

  // top-right look name
  ctx.textAlign = "right";
  ctx.fillText(lookName.toUpperCase(), w - pad - len - 8, pad + 2);
  ctx.textAlign = "left";

  // bottom-left monogram
  const xSize = Math.round(Math.min(w, h) * 0.04);
  ctx.fillStyle = "rgba(232,180,80,0.95)";
  ctx.font = `italic 600 ${xSize}px "Fraunces", serif`;
  ctx.textBaseline = "bottom";
  ctx.fillText("XJ", pad + 6, h - pad - 4);
}

function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const pad = Math.round(Math.min(w, h) * 0.018);
  const fontSize = Math.max(9, Math.round(Math.min(w, h) * 0.011));
  ctx.fillStyle = "rgba(247,236,210,0.7)";
  ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText("FRAMED BY XJ · xphotography20", w - pad - 4, h - pad - 4);
  ctx.textAlign = "left";
}
