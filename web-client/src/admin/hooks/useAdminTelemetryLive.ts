import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface EpochMetrics {
  train_loss: number;
  val_loss: number;
  val_f1: number;
  lr: number;
  global_grad_norm: number;
}

export interface LayerHistogram {
  counts: number[];
  mean: number;
  std: number;
  grad_norm: number;
  dead_neuron_pct: number;
}

export interface ConfusionMatrixData {
  classes: string[];
  matrix: number[][];
  precision: number;
  recall: number;
  macro_f1: number;
}

export interface TelemetryFrame {
  epoch: number;
  metrics: EpochMetrics;
  histograms: Record<string, LayerHistogram>;
  probe_activations: Record<string, number[][][]>;
  grad_cam: number[][];
  confusion: ConfusionMatrixData;
  decision_surface_offset?: number;
  community_points: Array<{ x: number; y: number; z: number; isMover: boolean; isHardNegative?: boolean; label: string }>;
}

export interface Hyperparameters {
  model: 'DipoleConvNet3D' | 'SpectralResNet102' | 'AstroFeatureSVM';
  batchSize: number;
  lr: number;
  optimizer: 'AdamW' | 'Adam' | 'SGD';
  totalEpochs: number;
  communityWeight: number;
}

export const ADMIN_LAYERS = [
  'Conv1_Spatial_Stem',
  'Conv2_Temporal_Residual',
  'Conv3_Dilated_Bottleneck',
  'Dense_Softmax_Head',
] as const;
export type AdminLayerName = typeof ADMIN_LAYERS[number];

const EMPTY_HYPERPARAMETERS: Hyperparameters = {
  model: 'DipoleConvNet3D', batchSize: 0, lr: 0, optimizer: 'AdamW', totalEpochs: 0, communityWeight: 0,
};

export function useAdminTelemetry() {
  const [hyperparams, setHyperparams] = useState<Hyperparameters>(EMPTY_HYPERPARAMETERS);
  const [hasStoredHyperparameters, setHasStoredHyperparameters] = useState(false);
  const [frames, setFrames] = useState<TelemetryFrame[]>([]);
  const [activeEpoch, setActiveEpoch] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [playbackSpeedMs, setPlaybackSpeedMs] = useState(400);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedLayer, setSelectedLayer] = useState<AdminLayerName>('Conv2_Temporal_Residual');
  const timerRef = useRef<number | null>(null);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    let requestController: AbortController | null = null;
    const load = async () => {
      const controller = new AbortController();
      requestController = controller;
      if (!hasLoadedRef.current) setIsLoading(true);
      let timedOut = false;
      const timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 8000);
      try {
        const response = await fetch('/api/admin/training/latest', { signal: controller.signal });
        if (!response.ok) throw new Error(`Training history request failed (${response.status})`);
        const payload = await response.json();
        if (!mounted) return;
        setIsConnected(true);
        const nextFrames = Array.isArray(payload?.run?.telemetry_frames) ? payload.run.telemetry_frames as TelemetryFrame[] : [];
        setFrames(nextFrames);
        if (nextFrames.length > 0) setActiveEpoch(nextFrames[nextFrames.length - 1].epoch);

        const stored = payload?.run?.hyperparameters;
        const values = stored && typeof stored === 'object' ? stored as Record<string, unknown> : {};
        const mapped: Hyperparameters = {
          model: (values.model ?? payload?.run?.model_architecture ?? EMPTY_HYPERPARAMETERS.model) as Hyperparameters['model'],
          batchSize: Number(values.batchSize ?? values.batch_size ?? 0),
          lr: Number(values.lr ?? values.learning_rate ?? 0),
          optimizer: (values.optimizer ?? EMPTY_HYPERPARAMETERS.optimizer) as Hyperparameters['optimizer'],
          totalEpochs: Number(values.totalEpochs ?? values.total_epochs ?? 0),
          communityWeight: Number(values.communityWeight ?? values.community_weight ?? 0),
        };
        const complete = mapped.batchSize > 0 && mapped.lr > 0 && mapped.totalEpochs > 0 && (values.communityWeight !== undefined || values.community_weight !== undefined);
        setHasStoredHyperparameters(complete);
        setHyperparams(complete ? mapped : EMPTY_HYPERPARAMETERS);
        setLoadError(nextFrames.length === 0 && payload?.available ? 'The latest persisted run contains no telemetry frames.' : null);
      } catch (cause) {
        if (!mounted || (controller.signal.aborted && !timedOut)) return;
        setIsConnected(false);
        setLoadError(timedOut ? 'Training history request timed out.' : cause instanceof Error ? cause.message : 'Training history is unavailable');
        setFrames([]);
        setHasStoredHyperparameters(false);
      } finally {
        window.clearTimeout(timeoutId);
        if (mounted) {
          hasLoadedRef.current = true;
          setIsLoading(false);
        }
      }
    };
    void load();
    const refreshId = window.setInterval(() => void load(), 15000);
    return () => {
      mounted = false;
      requestController?.abort();
      window.clearInterval(refreshId);
    };
  }, []);

  const totalEpochs = frames[frames.length - 1]?.epoch ?? 0;
  const currentFrame = useMemo(
    () => frames.find((frame) => frame.epoch === activeEpoch) ?? frames[frames.length - 1] ?? null,
    [frames, activeEpoch]
  );
  const overfittingAnalysis = useMemo(() => {
    let triggerEpoch: number | null = null;
    let optimalCheckpoint: number | null = null;
    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index];
      if (optimalCheckpoint === null || frame.metrics.val_loss < (frames.find((item) => item.epoch === optimalCheckpoint)?.metrics.val_loss ?? Infinity)) {
        optimalCheckpoint = frame.epoch;
      }
      if (index >= 3 && triggerEpoch === null) {
        const rising = [0, 1, 2].every((offset) => frames[index - offset].metrics.val_loss > frames[index - offset - 1].metrics.val_loss);
        if (rising && frame.metrics.train_loss < frames[index - 1].metrics.train_loss) triggerEpoch = frame.epoch;
      }
    }
    return {
      isOverfitting: triggerEpoch !== null,
      triggerEpoch,
      optimalCheckpoint,
      message: triggerEpoch === null ? 'No stored overfitting signal is present in this run.' : `Validation loss diverges at epoch ${triggerEpoch}; lowest stored validation loss is at epoch ${optimalCheckpoint}.`,
    };
  }, [frames]);

  useEffect(() => {
    if (isRunning && !isPaused && frames.length > 1) {
      timerRef.current = window.setInterval(() => {
        setActiveEpoch((previous) => {
          const index = frames.findIndex((frame) => frame.epoch === previous);
          const next = frames[index + 1];
          if (!next) {
            setIsRunning(false);
            return previous;
          }
          return next.epoch;
        });
      }, playbackSpeedMs);
    } else if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, [isRunning, isPaused, playbackSpeedMs, frames]);

  const startTrainingRun = useCallback(() => {
    if (frames.length < 2) return;
    setActiveEpoch(frames[0].epoch);
    setIsRunning(true);
    setIsPaused(false);
  }, [frames]);
  const pauseTrainingRun = useCallback(() => setIsPaused(true), []);
  const resumeTrainingRun = useCallback(() => setIsPaused(false), []);
  const abortTrainingRun = useCallback(() => { setIsRunning(false); setIsPaused(false); }, []);
  const scrubToEpoch = useCallback((epoch: number) => {
    const first = frames[0]?.epoch ?? 0;
    const last = frames[frames.length - 1]?.epoch ?? 0;
    setActiveEpoch(Math.max(first, Math.min(last, epoch)));
  }, [frames]);

  return {
    hyperparams,
    activeEpoch,
    totalEpochs,
    currentFrame,
    frames,
    isRunning,
    isPaused,
    playbackSpeedMs,
    setPlaybackSpeedMs,
    isConnected,
    isLoading,
    loadError,
    hasStoredHyperparameters,
    overfittingAnalysis,
    selectedLayer,
    setSelectedLayer,
    startTrainingRun,
    pauseTrainingRun,
    resumeTrainingRun,
    abortTrainingRun,
    scrubToEpoch,
  };
}
