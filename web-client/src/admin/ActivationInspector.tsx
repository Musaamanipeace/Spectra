import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useAdminTelemetry, ADMIN_LAYERS, AdminLayerName } from './hooks/useAdminTelemetryLive';
import { AdminDataState } from './AdminDataState';
import { Button, Badge, Select } from '../components/ui';
import { cn } from '../lib/utils';

/**
 * Tab 2: Parameter Updates & Activation Inspector (/admin/internals)
 * Specification Anchors: SPECIFICATION.md §6.4.3
 * 
 * Exposes internal numerical matrices of deep learning architectures:
 * - Pinned probe target (WISE 0855) evaluated every epoch
 * - Stacked 3D ridgeline weight/bias histograms across epochs (bins=40, range=[-1, 1])
 * - Dead neuron percentage (|w| < 1e-4), layer mean, std, gradient norm
 * - Forward feature maps (Layer 1 Centroids, Layer 2 Temporal Subtraction)
 * - Grad-CAM saliency projection overlay onto cutout
 */
export const ActivationInspector: React.FC = () => {
  const {
    activeEpoch,
    totalEpochs,
    currentFrame,
    frames,
    isLoading,
    loadError,
    selectedLayer,
    setSelectedLayer,
    scrubToEpoch,
  } = useAdminTelemetry();

  const ridgelineCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gradCamCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [activeChannel, setActiveChannel] = useState<number>(0);

  // Selected layer statistics from current active epoch
  const layerStats = useMemo(
    () => currentFrame?.histograms[selectedLayer],
    [currentFrame, selectedLayer]
  );

  // Render 3D Ridgeline Histograms
  useEffect(() => {
    const canvas = ridgelineCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#0B0F17';
    ctx.fillRect(0, 0, width, height);

    // Filter key epochs to render stacked ridgelines (e.g., Ep 10, 20, 30, 40, 50, or every 8 epochs up to activeEpoch)
    const step = Math.max(5, Math.floor(activeEpoch / 6));
    const targetEpochs: number[] = [];
    for (let ep = 10; ep <= activeEpoch; ep += step) {
      targetEpochs.push(ep);
    }
    if (!targetEpochs.includes(activeEpoch)) {
      targetEpochs.push(activeEpoch);
    }
    if (targetEpochs.length === 1 && targetEpochs[0] !== 1) {
      targetEpochs.unshift(1);
    }

    const padLeft = 60;
    const padRight = 30;
    const padBottom = 40;
    const padTop = 30;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    // Draw baseline axes
    ctx.strokeStyle = '#1E2530';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft, height - padBottom);
    ctx.lineTo(width - padRight, height - padBottom);
    ctx.stroke();

    // Weight axis ticks [-1.0, -0.5, 0.0, +0.5, +1.0]
    const ticks = [-1.0, -0.5, 0.0, 0.5, 1.0];
    ctx.fillStyle = '#64748B';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ticks.forEach((t) => {
      const x = padLeft + ((t + 1.0) / 2.0) * plotW;
      ctx.beginPath();
      ctx.moveTo(x, height - padBottom);
      ctx.lineTo(x, height - padBottom + 4);
      ctx.strokeStyle = '#334155';
      ctx.stroke();
      ctx.fillText(t > 0 ? `+${t.toFixed(1)}` : t.toFixed(1), x, height - padBottom + 16);
    });
    ctx.fillText('Weight Value (bins=40, range=[-1.0, +1.0])', padLeft + plotW / 2, height - padBottom + 30);

    // Render stacked ridgelines from earliest (top/back) to latest (bottom/front)
    const numLayers = targetEpochs.length;
    const verticalStep = numLayers > 1 ? (plotH * 0.75) / (numLayers - 1) : 0;

    targetEpochs.forEach((ep, idx) => {
      const frame = frames.find((f) => f.epoch === ep);
      if (!frame || !frame.histograms[selectedLayer]) return;

      const hist = frame.histograms[selectedLayer].counts;
      const maxCount = Math.max(...hist, 1);

      // Baseline for this ridgeline
      const baselineY = padTop + (idx * verticalStep) + 30;
      const ridgeHeight = 45;

      // Draw filled area
      ctx.beginPath();
      ctx.moveTo(padLeft, baselineY);

      hist.forEach((count, bIdx) => {
        const x = padLeft + (bIdx / (hist.length - 1)) * plotW;
        const normalized = count / maxCount;
        const y = baselineY - normalized * ridgeHeight;
        ctx.lineTo(x, y);
      });

      ctx.lineTo(padLeft + plotW, baselineY);
      ctx.closePath();

      // Gradient fill with pseudo-3D elevation
      const grad = ctx.createLinearGradient(0, baselineY - ridgeHeight, 0, baselineY);
      if (ep === activeEpoch) {
        grad.addColorStop(0, 'rgba(56, 189, 248, 0.85)'); // Active epoch highlight (Sky)
        grad.addColorStop(1, 'rgba(14, 165, 233, 0.25)');
      } else {
        grad.addColorStop(0, 'rgba(99, 102, 241, 0.65)'); // Prior epochs (Indigo)
        grad.addColorStop(1, 'rgba(30, 41, 59, 0.4)');
      }
      ctx.fillStyle = grad;
      ctx.fill();

      // Stroke outline
      ctx.strokeStyle = ep === activeEpoch ? '#38BDF8' : '#818CF8';
      ctx.lineWidth = ep === activeEpoch ? 2 : 1;
      ctx.stroke();

      // Baseline line
      ctx.strokeStyle = '#1E2530';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, baselineY);
      ctx.lineTo(padLeft + plotW, baselineY);
      ctx.stroke();

      // Epoch label on left
      ctx.fillStyle = ep === activeEpoch ? '#38BDF8' : '#94A3B8';
      ctx.font = ep === activeEpoch ? 'bold 10px ui-monospace, monospace' : '10px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`Ep ${ep}`, padLeft - 8, baselineY - 4);
    });
  }, [frames, activeEpoch, selectedLayer]);

  // Render Grad-CAM Saliency Overlay onto 32x32 Cutout Canvas
  useEffect(() => {
    const canvas = gradCamCanvasRef.current;
    if (!canvas || !currentFrame) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const size = 256; // 256x256 display

    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const gradCam = currentFrame.grad_cam;
    const pixelSize = size / 32;

    // Render only the returned saliency values; the telemetry contract has no cutout pixels.
    ctx.fillStyle = '#101722';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const sal = gradCam[y]?.[x] || 0;
        if (sal > 0.05) {
          // Jet colormap RGB interpolation
          let r = 0, g = 0, b = 0;
          if (sal < 0.25) {
            b = Math.round(sal * 4 * 255);
          } else if (sal < 0.5) {
            b = 255;
            g = Math.round((sal - 0.25) * 4 * 255);
          } else if (sal < 0.75) {
            g = 255;
            r = Math.round((sal - 0.5) * 4 * 255);
            b = Math.round((0.75 - sal) * 4 * 255);
          } else {
            r = 255;
            g = Math.round((1.0 - sal) * 4 * 255);
          }

          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${sal * 0.65})`;
          ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize + 0.5, pixelSize + 0.5);
        }
      }
    }

    // Dipole center marker
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(16 * pixelSize, 16 * pixelSize, 14, 0, Math.PI * 2);
    ctx.stroke();

    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(16 * pixelSize - 20, 16 * pixelSize);
    ctx.lineTo(16 * pixelSize + 20, 16 * pixelSize);
    ctx.moveTo(16 * pixelSize, 16 * pixelSize - 20);
    ctx.lineTo(16 * pixelSize, 16 * pixelSize + 20);
    ctx.stroke();
  }, [currentFrame]);

  // Current probe activations for the selected layer
  const featureMaps = useMemo(() => {
    if (!currentFrame || !currentFrame.probe_activations[selectedLayer]) {
      return [];
    }
    return currentFrame.probe_activations[selectedLayer]; // 4 channels of 16x16
  }, [currentFrame, selectedLayer]);

  if (isLoading || !currentFrame || !layerStats || !featureMaps) {
    return <AdminDataState title={loadError ? 'Activation telemetry unavailable' : 'No persisted activation data'} detail={loadError ?? 'Layer histograms and probe activations appear here only when supplied by a real model run.'} loading={isLoading} />;
  }

  return (
    <div className="flex flex-col h-full bg-background text-foreground p-4 gap-4 overflow-y-auto">
      {/* PERSISTED PROBE CONTEXT */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-sm border border-border bg-card p-3 shadow-sm">
        <p className="text-xs text-muted-foreground">Probe target metadata was not included in this telemetry response.</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Stored model run</span>
          <Badge variant="sky" className="font-mono text-[10px]">
            Epoch {activeEpoch} / {totalEpochs}
          </Badge>
        </div>
      </div>

      {/* DUAL PANEL: Left 50% 3D Ridgelines, Right 50% Activations & Grad-CAM */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-[460px]">
        {/* LEFT PANEL: Sequential 3D Weight Histograms */}
        <div className="flex flex-col rounded-sm border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between border-b border-border pb-2 mb-3 gap-2">
            <span className="text-xs font-semibold text-foreground">
              Sequential 3D weight histograms
            </span>
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-muted-foreground">Layer:</label>
              <Select
                sizeVariant="sm"
                value={selectedLayer}
                onChange={(e) => setSelectedLayer(e.target.value as AdminLayerName)}
              >
                {ADMIN_LAYERS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {/* 3D Ridgeline Canvas */}
          <div className="relative flex-1 min-h-[280px] w-full">
            <canvas
              ref={ridgelineCanvasRef}
              className="absolute inset-0 h-full w-full rounded-sm border border-border"
            />
          </div>

          {/* Layer Statistics Footer (SPECIFICATION.md §6.4.3) */}
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 border-t border-border pt-3 text-xs">
            <div className="rounded-sm bg-secondary/50 p-2 text-center border border-border/50">
              <div className="text-[10px] text-muted-foreground">Dead neuron metric</div>
              <div className="text-sm font-mono font-bold text-amber-400">
                {layerStats.dead_neuron_pct}%
              </div>
              <div className="text-[9px] text-muted-foreground">|w| &lt; 1e-4</div>
            </div>

            <div className="rounded-sm bg-secondary/50 p-2 text-center border border-border/50">
              <div className="text-[10px] text-muted-foreground">Layer mean</div>
              <div className="text-sm font-mono font-bold text-foreground">
                {layerStats.mean > 0 ? `+${layerStats.mean}` : layerStats.mean}
              </div>
              <div className="text-[9px] text-muted-foreground">Weight centroid</div>
            </div>

            <div className="rounded-sm bg-secondary/50 p-2 text-center border border-border/50">
              <div className="text-[10px] text-muted-foreground">Standard deviation</div>
              <div className="text-sm font-mono font-bold text-primary">
                {layerStats.std}
              </div>
              <div className="text-[9px] text-muted-foreground">Variance spread</div>
            </div>

            <div className="rounded-sm bg-secondary/50 p-2 text-center border border-border/50">
              <div className="text-[10px] text-muted-foreground">Layer gradient norm</div>
              <div className="text-sm font-mono font-bold text-emerald-400">
                {layerStats.grad_norm}
              </div>
              <div className="text-[9px] text-muted-foreground">Backprop step</div>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: Live Activation Heatmaps & Grad-CAM */}
        <div className="flex flex-col rounded-sm border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-border pb-2 mb-3">
            <span className="text-xs font-semibold text-foreground">
              Forward activations & Grad-CAM saliency
            </span>
            <Badge variant="outline" className="text-[10px] font-mono">
              Stored probe data
            </Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
            {/* Left Col: Forward Feature Maps */}
            <div className="flex flex-col gap-2">
              <div className="text-xs font-medium text-foreground">
                {selectedLayer === 'Conv1_Spatial_Stem'
                  ? 'Layer 1: Point source centroids'
                  : selectedLayer === 'Conv2_Temporal_Residual'
                  ? 'Layer 2: Temporal subtraction filter'
                  : 'Layer 3: Bottleneck representations'}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {selectedLayer.includes('Residual')
                  ? 'Static background stars zeroed out; positive/negative dipole lobes amplified.'
                  : 'Point sources extracted and high-frequency noise suppressed.'}
              </p>

              {/* 4 Feature Map Channels */}
              <div className="grid grid-cols-2 gap-2 mt-2">
                {[0, 1, 2, 3].map((ch) => {
                  const channelGrid = featureMaps[ch] || [];
                  const isActive = activeChannel === ch;
                  return (
                    <div
                      key={ch}
                      onClick={() => setActiveChannel(ch)}
                      className={cn(
                        'cursor-pointer rounded-sm border p-1.5 transition-colors',
                        isActive
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-secondary/40 hover:border-muted-foreground/50'
                      )}
                    >
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                        <span>Map {ch}</span>
                        {isActive && (
                          <span className="text-primary font-mono text-[9px]">ACTIVE</span>
                        )}
                      </div>
                      <div className="aspect-square w-full grid grid-cols-16 gap-0 bg-background rounded-xs overflow-hidden border border-border/50">
                        {channelGrid.map((row, r) =>
                          row.map((val, c) => {
                            const intensity = Math.max(0, Math.min(1, Math.abs(val)));
                            const color = val >= 0
                              ? `rgba(56, 189, 248, ${intensity})`
                              : `rgba(244, 63, 94, ${intensity})`;
                            return (
                              <div
                                key={`${r}-${c}`}
                                style={{ backgroundColor: color }}
                                className="w-full h-full"
                              />
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Col: Layer 3 + Grad-CAM Saliency Overlay */}
            <div className="flex flex-col items-center justify-center gap-2">
              <div className="text-xs font-medium text-foreground text-center">
                Layer 3 + Grad-CAM saliency overlay
              </div>
              <p className="text-[10px] text-muted-foreground text-center max-w-[240px]">
                Confirms network focuses on moving brown dwarf without latching onto edge noise.
              </p>

              <div className="relative rounded-sm border border-border bg-background p-2 shadow-inner">
                <canvas
                  ref={gradCamCanvasRef}
                  className="rounded-xs w-[220px] h-[220px]"
                />
              </div>

              {/* Mathematical Formulation Tooltip */}
              <div className="rounded-sm bg-secondary/60 p-2 text-center text-[10px] text-muted-foreground font-mono border border-border w-full max-w-[260px]">
                α_k^c = (1/Z) Σ_ij (∂y^c / ∂A_ij^k)<br />
                L_Grad-CAM = ReLU(Σ_k α_k^c A^k)
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ActivationInspector;
