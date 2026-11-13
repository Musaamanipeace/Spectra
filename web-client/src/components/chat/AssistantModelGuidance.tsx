import React, { useState } from 'react';
import { useTelemetryStore } from '../../store/useTelemetryStore';
import { cn } from '../../lib/utils';

export interface AssistantModelGuidanceProps {
  report?: {
    target: { ra: number; dec: number };
    overall_verdict: {
      category: string;
      confidence: number;
      explanation_summary: string;
    };
    motion?: {
      is_moving: boolean;
      mu_arcsec_yr: number;
      trajectory_angle_deg: number;
      centroid_drift_pixels: Array<{ epoch: number; mjd: number; x: number; y: number }>;
    };
    spectroscopy?: {
      best_match_class: string;
      cosine_similarity: number;
      key_absorption_features: string[];
    };
    variability?: {
      dipole_snr: number;
    };
  };
  onFeedbackLogged?: (feedback: 'confirmed' | 'false_positive') => void;
}

export const AssistantModelGuidance: React.FC<AssistantModelGuidanceProps> = ({
  report,
  onFeedbackLogged,
}) => {
  const { ra, dec, activeTargetName } = useTelemetryStore();
  const [feedbackStatus, setFeedbackStatus] = useState<'idle' | 'confirmed' | 'false_positive'>('idle');
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);

  // Default guidance if no report provided yet
  const targetCategory = report?.overall_verdict?.category || 'High-PM Brown Dwarf';
  const confidencePct = Math.round((report?.overall_verdict?.confidence || 0.94) * 100);
  const muYr = report?.motion?.mu_arcsec_yr ?? 8.12;
  const specClass = report?.spectroscopy?.best_match_class || 'T/Y-dwarf';
  const specSimPct = Math.round((report?.spectroscopy?.cosine_similarity || 0.92) * 100);

  const plainExplanation =
    report?.overall_verdict?.explanation_summary ||
    `The AI flagged this candidate because it shifted ${(muYr / 6.2 * 1.5).toFixed(1)} pixels between Epoch 1 and Epoch 3 (consistent with a nearby high-proper-motion object moving at ${muYr.toFixed(1)}"/yr), and its 102-channel light curve matches a ${specClass} with ${specSimPct}% confidence.`;

  const handleFeedback = (type: 'confirmed' | 'false_positive') => {
    setFeedbackStatus(type);
    const label = type === 'confirmed' ? 'Verified Discovery' : 'False-Positive Flag';
    setFeedbackNotice(`✓ Marked as "${label}" · Logged as an active-learning training sample!`);
    onFeedbackLogged?.(type);
    setTimeout(() => setFeedbackNotice(null), 4000);
  };

  return (
    <div className="rounded-xl border border-sky-500/30 bg-neutral-950/80 p-4 shadow-xl backdrop-blur-md">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between border-b border-neutral-800 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500/20 text-xs text-sky-300">
            🤖
          </span>
          <span className="text-xs font-semibold text-white">AI Decision Explainability</span>
        </div>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-mono font-bold uppercase',
            targetCategory.includes('Brown Dwarf') && 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
            targetCategory.includes('Variable') && 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
            targetCategory.includes('Ice') && 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30',
            targetCategory.includes('Artifact') && 'bg-rose-500/20 text-rose-300 border border-rose-500/30',
            targetCategory.includes('Unresolved') && 'bg-neutral-800 text-neutral-300'
          )}
        >
          {targetCategory} ({confidencePct}%)
        </span>
      </div>

      {/* Plain English Assistant Explanation */}
      <div className="rounded-lg border border-sky-500/20 bg-sky-950/20 p-3 text-xs leading-relaxed text-sky-100">
        <p className="font-medium text-white mb-1">Why did the model reach this verdict?</p>
        <p>{plainExplanation}</p>
      </div>

      {/* 2D Cluster Position Preview */}
      <div className="mt-3 flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900/60 p-2.5 text-[11px]">
        <div className="flex flex-col gap-0.5">
          <span className="text-neutral-400">Target Coordinates</span>
          <span className="font-mono text-white">
            RA {(report?.target?.ra ?? ra).toFixed(4)}°, Dec {(report?.target?.dec ?? dec).toFixed(4)}°
          </span>
        </div>
        <div className="flex flex-col gap-0.5 text-right">
          <span className="text-neutral-400">Cluster Proximity</span>
          <span className="font-mono text-emerald-400">
            {targetCategory.includes('Brown Dwarf') ? 'Y/T Dwarf Cluster' : 'Stellar Locus'}
          </span>
        </div>
      </div>

      {/* Active-Learning User Feedback Actions */}
      <div className="mt-3 border-t border-neutral-800 pt-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          Citizen Science Active-Learning Verification
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => handleFeedback('confirmed')}
            className={cn(
              'flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all',
              feedbackStatus === 'confirmed'
                ? 'border-emerald-500 bg-emerald-500 text-black'
                : 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300 hover:bg-emerald-500 hover:text-black'
            )}
          >
            ✓ Confirm Candidate
          </button>
          <button
            type="button"
            onClick={() => handleFeedback('false_positive')}
            className={cn(
              'flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all',
              feedbackStatus === 'false_positive'
                ? 'border-rose-500 bg-rose-500 text-black'
                : 'border-rose-500/40 bg-rose-950/20 text-rose-300 hover:bg-rose-500 hover:text-black'
            )}
          >
            ✕ False Positive
          </button>
        </div>

        {feedbackNotice && (
          <div className="mt-2 text-center text-[11px] font-mono text-emerald-400 animate-in fade-in">
            {feedbackNotice}
          </div>
        )}
      </div>
    </div>
  );
};
