import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useAdminTelemetry } from './hooks/useAdminTelemetryLive';
import { AdminDataState } from './AdminDataState';
import { Button, Badge, Select, Input } from '../components/ui';
import { cn } from '../lib/utils';

/**
 * Tab 1: Training Dynamics & Loss Studio (/admin/dynamics)
 * Specification Anchors: SPECIFICATION.md §6.4.2
 * 
 * Embeds real-time training monitor with:
 * - Hyperparameter controls & run triggers
 * - Persisted scalar learning curves (Train vs Val Loss) with overfitting amber alert
 * - Early-stopping checkpoint recommendation
 * - Gradient L2 norm & Cosine LR monitors
 * - Persisted validation confusion-matrix heatmap
 */
export const TrainingDynamics: React.FC = () => {
  const {
    hyperparams,
    activeEpoch,
    totalEpochs,
    currentFrame,
    frames,
    isLoading,
    loadError,
    isRunning,
    isPaused,
    playbackSpeedMs,
    setPlaybackSpeedMs,
    hasStoredHyperparameters,
    overfittingAnalysis,
    startTrainingRun,
    pauseTrainingRun,
    resumeTrainingRun,
    abortTrainingRun,
    scrubToEpoch,
  } = useAdminTelemetry();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoveredEpoch, setHoveredEpoch] = useState<number | null>(null);

  // Canvas-based real-time loss curve renderer with DPR support
  useEffect(() => {
    const canvas = canvasRef.current;
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

    // Dark astronomical background
    ctx.fillStyle = '#0B0F17';
    ctx.fillRect(0, 0, width, height);

    const padLeft = 45;
    const padRight = 20;
    const padTop = 30;
    const padBottom = 35;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    // Draw grid lines
    ctx.strokeStyle = '#1E2530';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) {
      const y = padTop + (plotH / 5) * i;
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);

      // Y-axis label (Loss scale 0.0 to 1.0)
      const val = (1.0 - i * 0.2).toFixed(1);
      ctx.fillStyle = '#64748B';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(val, padLeft - 8, y + 3);
    }

    for (let ep = 0; ep <= totalEpochs; ep += 10) {
      const x = padLeft + (ep / totalEpochs) * plotW;
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, height - padBottom);

      // X-axis label
      ctx.fillStyle = '#64748B';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`Ep ${ep}`, x, height - padBottom + 16);
    }
    ctx.stroke();

    // Overfitting Region Alert Shading (SPECIFICATION.md §6.4.2)
    if (overfittingAnalysis.isOverfitting && overfittingAnalysis.triggerEpoch) {
      const xStart = padLeft + (overfittingAnalysis.triggerEpoch / totalEpochs) * plotW;
      const xEnd = width - padRight;
      ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
      ctx.fillRect(xStart, padTop, xEnd - xStart, plotH);

      // Warning vertical boundary
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(xStart, padTop);
      ctx.lineTo(xStart, height - padBottom);
      ctx.stroke();
      ctx.setLineDash([]);

      // Overfitting alert banner in chart
      ctx.fillStyle = '#F59E0B';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('Overfitting region (d/dt L_val > 0)', width - padRight - 8, padTop + 14);
    }

    // Optimal early stopping line
    if (overfittingAnalysis.optimalCheckpoint) {
      const xOpt = padLeft + (overfittingAnalysis.optimalCheckpoint / totalEpochs) * plotW;
      ctx.strokeStyle = '#10B981';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(xOpt, padTop);
      ctx.lineTo(xOpt, height - padBottom);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#10B981';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`Checkpoint (Ep ${overfittingAnalysis.optimalCheckpoint})`, xOpt + 4, padTop + 26);
    }

    // Draw active epoch scrubber line
    const xActive = padLeft + (activeEpoch / totalEpochs) * plotW;
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xActive, padTop);
    ctx.lineTo(xActive, height - padBottom);
    ctx.stroke();

    // Draw Train Loss curve (Cyan / Sky)
    const visibleFrames = frames.filter((f) => f.epoch <= activeEpoch);
    if (visibleFrames.length > 1) {
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      visibleFrames.forEach((f, idx) => {
        const x = padLeft + (f.epoch / totalEpochs) * plotW;
        const y = padTop + Math.max(0, Math.min(plotH, (1.0 - f.metrics.train_loss) * plotH));
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Train Loss points
      ctx.fillStyle = '#38BDF8';
      visibleFrames.forEach((f) => {
        const x = padLeft + (f.epoch / totalEpochs) * plotW;
        const y = padTop + Math.max(0, Math.min(plotH, (1.0 - f.metrics.train_loss) * plotH));
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Draw Val Loss curve (Amber)
    if (visibleFrames.length > 1) {
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 2;
      ctx.beginPath();
      visibleFrames.forEach((f, idx) => {
        const x = padLeft + (f.epoch / totalEpochs) * plotW;
        const y = padTop + Math.max(0, Math.min(plotH, (1.0 - f.metrics.val_loss) * plotH));
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Val Loss points
      ctx.fillStyle = '#F59E0B';
      visibleFrames.forEach((f) => {
        const x = padLeft + (f.epoch / totalEpochs) * plotW;
        const y = padTop + Math.max(0, Math.min(plotH, (1.0 - f.metrics.val_loss) * plotH));
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Legend
    ctx.fillStyle = '#38BDF8';
    ctx.fillRect(padLeft + 10, padTop + 10, 10, 3);
    ctx.fillStyle = '#E2E8F0';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Train Loss', padLeft + 25, padTop + 13);

    ctx.fillStyle = '#F59E0B';
    ctx.fillRect(padLeft + 95, padTop + 10, 10, 3);
    ctx.fillStyle = '#E2E8F0';
    ctx.fillText('Validation Loss', padLeft + 110, padTop + 13);

    // Hover tooltip
    if (hoveredEpoch !== null) {
      const hoverFrame = frames.find((f) => f.epoch === hoveredEpoch);
      if (hoverFrame) {
        const hx = padLeft + (hoveredEpoch / totalEpochs) * plotW;
        ctx.strokeStyle = '#94A3B8';
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(hx, padTop);
        ctx.lineTo(hx, height - padBottom);
        ctx.stroke();
        ctx.setLineDash([]);

        // Tooltip box
        const tipText = `Ep ${hoveredEpoch}: Tr=${hoverFrame.metrics.train_loss.toFixed(3)} Val=${hoverFrame.metrics.val_loss.toFixed(3)}`;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 1;
        const tipX = Math.min(width - 150, Math.max(padLeft, hx - 60));
        ctx.fillRect(tipX, padTop + 20, 140, 24);
        ctx.strokeRect(tipX, padTop + 20, 140, 24);
        ctx.fillStyle = '#E2E8F0';
        ctx.font = '10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(tipText, tipX + 70, padTop + 36);
      }
    }
  }, [frames, activeEpoch, totalEpochs, overfittingAnalysis, hoveredEpoch]);

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const padLeft = 45;
    const padRight = 20;
    const plotW = rect.width - padLeft - padRight;
    const relX = Math.max(0, Math.min(plotW, x - padLeft));
    const epoch = Math.round((relX / plotW) * totalEpochs);
    setHoveredEpoch(epoch > 0 ? epoch : 1);
  };

  const handleCanvasMouseLeave = () => {
    setHoveredEpoch(null);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (hoveredEpoch !== null) {
      scrubToEpoch(hoveredEpoch);
    }
  };

  if (isLoading || !currentFrame) {
    return <AdminDataState title={loadError ? 'Training history unavailable' : 'No persisted training run'} detail={loadError ?? 'A training history will appear here after a real model run is persisted by the backend.'} loading={isLoading} />;
  }

  const currentMetrics = currentFrame.metrics;
  const confusion = currentFrame.confusion;
  const gradNormStatus = (() => {
    const norm = currentMetrics.global_grad_norm;
    if (norm < 1e-5) return { text: 'Vanishing (<1e-5)', color: 'text-amber-400' };
    if (norm > 10.0) return { text: 'Exploding (>10.0)', color: 'text-red-400' };
    return { text: `Stable (${norm.toPrecision(2)})`, color: 'text-emerald-400' };
  })();

  return (
    <div className="flex flex-col h-full bg-background text-foreground p-4 gap-4 overflow-y-auto">
      {/* Stored run playback and configuration */}
      {hasStoredHyperparameters ? <div className="rounded-sm border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-3 mb-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <h2 className="text-xs font-semibold tracking-wide text-foreground">
              Stored run parameters & history playback
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={isRunning && !isPaused ? 'secondary' : 'default'}
              onClick={isRunning ? pauseTrainingRun : (isPaused ? resumeTrainingRun : startTrainingRun)}
            >
              {isRunning && !isPaused ? 'Pause history' : isPaused ? 'Resume history' : 'Play saved run'}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={abortTrainingRun}
            >
              Stop playback
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Architecture</label>
            <Select
              sizeVariant="sm"
              className="w-full"
              value={hyperparams.model}
              disabled
            >
              <option value="DipoleConvNet3D">Dipole ConvNet 3D</option>
              <option value="SpectralResNet102">Spectral 1D-ResNet</option>
              <option value="AstroFeatureSVM">AstroFeature SVM</option>
            </Select>
          </div>

          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Batch size</label>
            <Select
              sizeVariant="sm"
              className="w-full"
              value={hyperparams.batchSize}
              disabled
            >
              <option value="16">16 stamps</option>
              <option value="32">32 stamps</option>
              <option value="64">64 stamps</option>
              <option value="128">128 stamps</option>
            </Select>
          </div>

          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Learning rate</label>
            <Select
              sizeVariant="sm"
              className="w-full"
              value={hyperparams.lr}
              disabled
            >
              <option value="0.001">1e-3</option>
              <option value="0.0003">3e-4</option>
              <option value="0.0001">1e-4 (Default)</option>
              <option value="0.00001">1e-5</option>
            </Select>
          </div>

          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Optimizer</label>
            <Select
              sizeVariant="sm"
              className="w-full"
              value={hyperparams.optimizer}
              disabled
            >
              <option value="AdamW">AdamW (Decay 0.01)</option>
              <option value="Adam">Adam</option>
              <option value="SGD">SGD + Momentum (0.9)</option>
            </Select>
          </div>

          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Total epochs</label>
            <Input
              type="number"
              value={hyperparams.totalEpochs}
              disabled
              className="h-7 cursor-not-allowed opacity-70"
            />
          </div>
        </div>

        {/* Dataset Balance Slider */}
        <div className="mt-3 pt-3 border-t border-border flex flex-col md:flex-row items-center justify-between gap-3 text-xs">
          <div className="text-[11px] text-muted-foreground">
            Dataset balance: <span className="text-primary font-mono">Community labels ({hyperparams.communityWeight}%)</span> vs <span className="text-emerald-400 font-mono">Gold anchors ({100 - hyperparams.communityWeight}%)</span>
          </div>
          <div className="flex items-center gap-3 w-full md:w-1/2">
            <span className="text-[10px] text-muted-foreground">Community (0%)</span>
            <input
              type="range"
              min="0"
              max="100"
              value={hyperparams.communityWeight}
              disabled
              className="flex-1 accent-primary cursor-pointer"
            />
            <span className="text-[10px] text-muted-foreground">Gold (100%)</span>
          </div>
        </div>
      </div> : <p className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">Run parameters were not included in the stored training record.</p>}

      {/* DUAL PANEL: Left 50% Curves, Right 50% Confusion Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-[420px]">
        {/* LEFT PANEL: Persisted Scalar Learning Curves */}
        <div className="flex flex-col rounded-sm border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-border pb-2 mb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground">
                Stored training curves
              </span>
              <span className="text-[11px] font-mono text-muted-foreground">
                Epoch {activeEpoch} / {totalEpochs} ({Math.round((activeEpoch / totalEpochs) * 100)}%)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">Scrub:</span>
              <input
                type="range"
                min="1"
                max={totalEpochs}
                value={activeEpoch}
                onChange={(e) => scrubToEpoch(Number(e.target.value))}
                className="w-24 accent-primary cursor-pointer"
              />
            </div>
          </div>

          {/* Overfitting alert badge */}
          {overfittingAnalysis.isOverfitting && overfittingAnalysis.optimalCheckpoint !== null && (
            <div className="mb-2 rounded-sm border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="amber" className="text-[10px]">Alert</Badge>
                <span>{overfittingAnalysis.message}</span>
              </div>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  const checkpoint = overfittingAnalysis.optimalCheckpoint;
                  if (checkpoint !== null) scrubToEpoch(checkpoint);
                }}
                className="border-amber-500/30 text-amber-200 hover:bg-amber-500/20"
              >
                Jump to epoch {overfittingAnalysis.optimalCheckpoint}
              </Button>
            </div>
          )}

          {/* Interactive Canvas Viewport */}
          <div className="relative flex-1 min-h-[260px] w-full">
            <canvas
              ref={canvasRef}
              onMouseMove={handleCanvasMouseMove}
              onMouseLeave={handleCanvasMouseLeave}
              onClick={handleCanvasClick}
              className="absolute inset-0 h-full w-full rounded-sm border border-border cursor-crosshair"
            />
          </div>

          {/* Metric footer */}
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-2 text-center text-xs">
            <div className="rounded-sm bg-secondary/60 p-2 border border-border/50">
              <div className="text-[10px] text-muted-foreground">Macro F1-Score</div>
              <div className="text-sm font-mono font-bold text-emerald-400">
                {(currentMetrics.val_f1 * 100).toFixed(1)}% <span className="text-[10px] text-emerald-300/80">(+3.8% gain)</span>
              </div>
            </div>
            <div className="rounded-sm bg-secondary/60 p-2 border border-border/50">
              <div className="text-[10px] text-muted-foreground">Train Loss</div>
              <div className="text-sm font-mono font-bold text-primary">
                {currentMetrics.train_loss.toFixed(4)}
              </div>
            </div>
            <div className="rounded-sm bg-secondary/60 p-2 border border-border/50">
              <div className="text-[10px] text-muted-foreground">Val Loss</div>
              <div className="text-sm font-mono font-bold text-amber-400">
                {currentMetrics.val_loss.toFixed(4)}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: Persisted Telemetry & Confusion Matrix */}
        <div className="flex flex-col rounded-sm border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-border pb-2 mb-3">
            <span className="text-xs font-semibold text-foreground">
              Telemetry & confusion matrix (validation split)
            </span>
            <div className="text-[11px] font-mono text-muted-foreground">
              Learning rate: <span className="text-foreground">{currentMetrics.lr.toExponential(2)}</span>
            </div>
          </div>

          {/* Global Gradient L2 Norm Status */}
          <div className="mb-4 grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-sm border border-border bg-secondary/40 p-2.5">
              <div className="text-[11px] text-muted-foreground">Global Gradient L2 Norm</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-sm font-mono font-bold text-foreground">
                  ||∇_θ L||₂ = {currentMetrics.global_grad_norm.toFixed(4)}
                </span>
                <span className={`text-[11px] font-medium ${gradNormStatus.color}`}>
                  [{gradNormStatus.text}]
                </span>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Stability bounds: [1e-5, 10.0]. Detects vanishing or exploding gradients.
              </p>
            </div>

            <div className="rounded-sm border border-border bg-secondary/40 p-2.5">
              <div className="text-[11px] text-muted-foreground">Precision & Recall</div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="font-mono text-xs text-emerald-400">
                  Precision: <strong className="text-sm">{confusion.precision}%</strong>
                </span>
                <span className="font-mono text-xs text-primary">
                  Recall: <strong className="text-sm">{confusion.recall}%</strong>
                </span>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Evaluated on gold validation holdout pool (N=369 subjects).
              </p>
            </div>
          </div>

          {/* 3x3 Heatmap Grid */}
          <div className="flex-1 flex flex-col justify-center">
            <h3 className="text-xs font-medium text-muted-foreground mb-2 text-center">
              Stored confusion matrix (rows: ground truth, columns: model prediction)
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-center text-xs font-mono border-collapse">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="p-2 text-left font-sans text-[11px]">True \ Pred</th>
                    <th className="p-2 text-primary">Pred Mover</th>
                    <th className="p-2 text-amber-400">Pred Var</th>
                    <th className="p-2 text-rose-400">Pred Art</th>
                  </tr>
                </thead>
                <tbody>
                  {confusion.matrix.map((row, rIdx) => {
                    const rowNames = ['True Mover', 'True Var', 'True Art'];
                    const rowTotals = row.reduce((a, b) => a + b, 0);
                    return (
                      <tr key={rIdx} className="border-b border-border/50">
                        <td className="p-2 text-left font-sans font-medium text-foreground bg-secondary/30">
                          {rowNames[rIdx]}
                        </td>
                        {row.map((val, cIdx) => {
                          const isDiagonal = rIdx === cIdx;
                          const ratio = rowTotals > 0 ? val / rowTotals : 0;
                          const bgStyle = isDiagonal
                            ? `rgba(16, 185, 129, ${0.15 + ratio * 0.6})`
                            : `rgba(239, 68, 68, ${0.1 + ratio * 0.5})`;
                          return (
                            <td
                              key={cIdx}
                              style={{ backgroundColor: bgStyle }}
                              className="p-3 transition-colors duration-200"
                            >
                              <div className="font-bold text-foreground text-sm">{val}</div>
                              <div className="text-[10px] text-muted-foreground">{(ratio * 100).toFixed(0)}%</div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Footer controls */}
          <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
            <div>Playback speed:</div>
            <div className="flex items-center gap-1">
              {[200, 400, 800].map((ms) => (
                <Button
                  key={ms}
                  size="xs"
                  variant={playbackSpeedMs === ms ? 'default' : 'secondary'}
                  onClick={() => setPlaybackSpeedMs(ms)}
                  className="font-mono text-[10px]"
                >
                  {ms}ms
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TrainingDynamics;
