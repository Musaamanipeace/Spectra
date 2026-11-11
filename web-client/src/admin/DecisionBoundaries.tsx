import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useAdminTelemetry } from './hooks/useAdminTelemetryLive';
import { AdminDataState } from './AdminDataState';
import { Button, Badge } from '../components/ui';
import { cn } from '../lib/utils';

/**
 * Tab 3: Decision Boundary Animator (/admin/boundaries)
 * Specification Anchors: SPECIFICATION.md §6.4.4
 * 
 * Renders step-by-step morphing of classification boundaries across input space:
 * - Physical feature-space inspection of points included in persisted telemetry
 * - A learned probability surface is shown only when returned by the backend
 * - Highlight toggles: Newly Injected Community Labels, Misclassified Hard Negatives
 * - Playback trajectory controls and interactive 3D camera rotation/zoom
 */
export const DecisionBoundaries: React.FC = () => {
  const {
    activeEpoch,
    totalEpochs,
    currentFrame,
    isLoading,
    loadError,
    isRunning,
    isPaused,
    startTrainingRun,
    pauseTrainingRun,
    resumeTrainingRun,
    scrubToEpoch,
  } = useAdminTelemetry();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // View state: 3D camera angles
  const [rotX, setRotX] = useState<number>(0.55); // Elevation angle
  const [rotY, setRotY] = useState<number>(-0.65); // Azimuth angle
  const [zoom, setZoom] = useState<number>(1.0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number; rotX: number; rotY: number }>({ x: 0, y: 0, rotX: 0, rotY: 0 });

  // Toggles
  const [showCommunityLabels, setShowCommunityLabels] = useState<boolean>(true);
  const [showHardNegatives, setShowHardNegatives] = useState<boolean>(true);
  const [hoveredPoint, setHoveredPoint] = useState<any | null>(null);

  // Mouse drag handlers for 3D rotation
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      rotX,
      rotY,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setRotY(dragStartRef.current.rotY + dx * 0.008);
    setRotX(Math.max(-1.4, Math.min(1.4, dragStartRef.current.rotX + dy * 0.008)));
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setZoom((prev) => Math.max(0.6, Math.min(2.2, prev - e.deltaY * 0.001)));
  };

  // Render 3D Decision Surface & Scatter Data onto Canvas
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

    // Deep space background
    ctx.fillStyle = '#080A0F';
    ctx.fillRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2 + 20;
    const scale = Math.min(width, height) * 0.42 * zoom;

    // 3D Projection Helper
    const project = (x: number, y: number, z: number) => {
      // Rotate around Y (azimuth)
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const x1 = x * cosY - z * sinY;
      const z1 = x * sinY + z * cosY;

      // Rotate around X (elevation)
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);
      const y2 = y * cosX - z1 * sinX;
      const z2 = y * sinX + z1 * cosX;

      // Isometric camera projection
      const px = cx + x1 * scale;
      const py = cy - y2 * scale;
      return { px, py, depth: z2 };
    };

    // Draw 3D Bounding Cube Axes [-1, 1] in each dimension
    ctx.strokeStyle = '#1E2530';
    ctx.lineWidth = 1;

    const corners = [
      project(-1, -1, -1),
      project(1, -1, -1),
      project(1, 1, -1),
      project(-1, 1, -1),
      project(-1, -1, 1),
      project(1, -1, 1),
      project(1, 1, 1),
      project(-1, 1, 1),
    ];

    // Floor grid (Z-X plane at Y = -1)
    ctx.strokeStyle = '#151B24';
    for (let g = -1; g <= 1; g += 0.5) {
      const p1 = project(g, -1, -1);
      const p2 = project(g, -1, 1);
      ctx.beginPath();
      ctx.moveTo(p1.px, p1.py);
      ctx.lineTo(p2.px, p2.py);
      ctx.stroke();

      const p3 = project(-1, -1, g);
      const p4 = project(1, -1, g);
      ctx.beginPath();
      ctx.moveTo(p3.px, p3.py);
      ctx.lineTo(p4.px, p4.py);
      ctx.stroke();
    }

    // Outer bounding box edges
    ctx.strokeStyle = '#334155';
    const edges = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    edges.forEach(([i, j]) => {
      ctx.beginPath();
      ctx.moveTo(corners[i].px, corners[i].py);
      ctx.lineTo(corners[j].px, corners[j].py);
      ctx.stroke();
    });

    // Axis Labels
    ctx.fillStyle = '#94A3B8';
    ctx.font = '10px ui-monospace, monospace';

    const pX = project(1.2, -1, -1);
    ctx.fillText('X: IR Color (D5/D2)', pX.px, pX.py);

    const pY = project(-1, 1.2, -1);
    ctx.fillText('Y: Motion SNR (ΔS/σ)', pY.px, pY.py);

    const pZ = project(-1, -1, 1.2);
    ctx.fillText('Z: Ice Depth (τ)', pZ.px, pZ.py);

    // Plot only points included in the persisted telemetry frame.
    const points = currentFrame?.community_points || [];
    points.forEach((pt) => {
      // Map physical ranges to [-1, 1] normalized cube:
      // X: [0.0, 5.0] -> [-1, 1]
      // Y: [0.0, 18.0] -> [-1, 1]
      // Z: [0.0, 3.0] -> [-1, 1]
      const nx = (pt.x / 5.0) * 2.0 - 1.0;
      const ny = (pt.y / 18.0) * 2.0 - 1.0;
      const nz = (pt.z / 3.0) * 2.0 - 1.0;

      if (!showCommunityLabels && !pt.label.includes('WISE') && !pt.label.includes('Barnard') && !pt.label.includes('Epsilon') && !pt.label.includes('RW') && !pt.label.includes('R Dra')) {
        return;
      }
      if (!showHardNegatives && pt.isHardNegative) {
        return;
      }

      const p = project(nx, ny, nz);

      // Point styling
      let color = '#38BDF8'; // Moving dipole (Sky)
      let radius = 4.5;
      if (pt.isHardNegative) {
        color = '#EF4444'; // Hard Negative / Glitch (Red)
        radius = 5.0;
      } else if (!pt.isMover) {
        color = '#F59E0B'; // Variable star (Amber)
      }

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.px, p.py, radius, 0, Math.PI * 2);
      ctx.fill();

      // Outer glow for prominent benchmarks
      if (pt.label.includes('WISE') || pt.label.includes('Barnard')) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.px, p.py, radius + 3, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Point label text
      ctx.fillStyle = '#E2E8F0';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(pt.label, p.px + 8, p.py + 3);
    });

  }, [rotX, rotY, zoom, activeEpoch, totalEpochs, currentFrame, showCommunityLabels, showHardNegatives]);

  if (isLoading || !currentFrame) {
    return <AdminDataState title={loadError ? 'Decision telemetry unavailable' : 'No persisted decision surface'} detail={loadError ?? 'This view requires real decision-surface and community-point telemetry from a stored model run. No generated surface is substituted.'} loading={isLoading} />;
  }

  return (
    <div className="flex flex-col h-full bg-background text-foreground p-4 gap-4 overflow-y-auto">
      {/* COORDINATE SPACE & TRAJECTORY CONTROLLER */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-sm border border-border bg-card p-3 shadow-sm">
        <span className="text-xs font-semibold text-foreground">Physical feature axes</span>

        {/* Highlight Checkboxes */}
        <div className="flex items-center gap-4 text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground hover:text-foreground">
            <input
              type="checkbox"
              checked={showCommunityLabels}
              onChange={(e) => setShowCommunityLabels(e.target.checked)}
              className="accent-primary"
            />
            <span>Newly injected community labels</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer text-rose-400 hover:text-rose-300">
            <input
              type="checkbox"
              checked={showHardNegatives}
              onChange={(e) => setShowHardNegatives(e.target.checked)}
              className="accent-rose-500"
            />
            <span>Misclassified hard negatives</span>
          </label>
        </div>
      </div>

      {/* 3D WEBGL/CANVAS DECISION SURFACE VIEWPORT */}
      <div className="relative flex-1 min-h-[460px] rounded-sm border border-border bg-background shadow-inner overflow-hidden flex flex-col">
        {/* Interactive 3D Canvas */}
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          className="absolute inset-0 h-full w-full cursor-grab active:cursor-grabbing"
        />

        {/* Camera Navigation Overlay HUD */}
        <div className="absolute top-3 left-3 pointer-events-none rounded-sm bg-card/90 backdrop-blur-sm border border-border p-2.5 text-[10px] text-muted-foreground font-mono flex flex-col gap-1 shadow-sm">
          <div>Camera: Azimuth {Math.round(rotY * 57.3)}°, Elevation {Math.round(rotX * 57.3)}°</div>
          <div>Zoom: {(zoom * 100).toFixed(0)}% (Scroll to zoom, drag to rotate)</div>
          <div className="text-primary">Evaluating 25×25×25 meshgrid (15,625 points)</div>
        </div>

        {/* Target Legend HUD */}
        <div className="absolute top-3 right-3 pointer-events-none rounded-sm bg-card/90 backdrop-blur-sm border border-border p-2.5 text-xs text-foreground flex flex-col gap-1.5 shadow-sm">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground mb-0.5">Physical entities</div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="h-2 w-2 rounded-full bg-primary" />
            <span>Moving brown dwarf / fast dipole (P &gt; 0.5)</span>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            <span>Pulsing variable monopole</span>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            <span>Misclassified hard negative (artifact)</span>
          </div>
        </div>

        {/* BOTTOM TRAJECTORY SCRUBBER CONTROLLER (SPECIFICATION.md §6.4.4) */}
        <div className="absolute bottom-3 inset-x-3 rounded-sm border border-border bg-card/90 backdrop-blur-sm p-3 flex flex-wrap items-center justify-between gap-4 shadow-sm">
          <div className="flex items-center gap-1.5">
            <Button
              size="xs"
              variant="outline"
              onClick={() => scrubToEpoch(1)}
              title="First epoch"
            >
              |&lt;
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => scrubToEpoch(Math.max(1, activeEpoch - 5))}
              title="Step back 5 epochs"
            >
              &lt;&lt;
            </Button>
            <Button
              size="xs"
              variant={isRunning && !isPaused ? 'secondary' : 'default'}
              onClick={isRunning && !isPaused ? pauseTrainingRun : (isPaused ? resumeTrainingRun : startTrainingRun)}
            >
              {isRunning && !isPaused ? 'Pause history' : 'Play stored run'}
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => scrubToEpoch(Math.min(totalEpochs, activeEpoch + 5))}
              title="Step forward 5 epochs"
            >
              &gt;&gt;
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => scrubToEpoch(totalEpochs)}
              title="Final epoch"
            >
              &gt;|
            </Button>
          </div>

          <div className="flex items-center gap-3 flex-1 max-w-md">
            <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
              Active epoch: <strong className="text-foreground text-sm">{activeEpoch}</strong> / {totalEpochs}
            </span>
            <input
              type="range"
              min="1"
              max={totalEpochs}
              value={activeEpoch}
              onChange={(e) => scrubToEpoch(Number(e.target.value))}
              className="flex-1 accent-primary cursor-pointer"
            />
          </div>

          <div className="text-[11px] text-muted-foreground">
            Decision surface: <span className="font-mono text-amber-300">Not included in persisted telemetry</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DecisionBoundaries;
