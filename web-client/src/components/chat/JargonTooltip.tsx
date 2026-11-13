import React, { useState } from 'react';

export interface JargonDefinition {
  term: string;
  simpleTerm?: string;
  plainEnglish: string;
  scientificContext?: string;
}

export const ASTRONOMY_JARGON: Record<string, JargonDefinition> = {
  moc: {
    term: 'MOC (Multi-Order Coverage)',
    simpleTerm: 'Survey Footprint',
    plainEnglish: 'A sky map showing the exact boundary where SPHEREx has gathered observation exposures.',
    scientificContext: 'IVOA standard HEALPix-based hierarchical spatial coverage structure.',
  },
  asinh: {
    term: 'Asinh Stretch',
    simpleTerm: 'Smart Contrast',
    plainEnglish: 'A dynamic contrast filter that brings out ultra-faint gas clouds without washing out bright stars.',
    scientificContext: 'Inverse hyperbolic sine intensity mapping preserving linearity at low SNR.',
  },
  differencing: {
    term: 'Wavelength-Matched Differencing',
    simpleTerm: 'Color-Matched Image Subtraction',
    plainEnglish: 'Subtracting two pictures taken at the exact same infrared color months apart to make moving or flashing objects pop out.',
    scientificContext: 'I_epochN(lambda) - I_epoch0(lambda) within strict bandpass window [lambda_0(1-w), lambda_0(1+w)].',
  },
  wcs_wave: {
    term: 'HDU 6 WCS-WAVE',
    simpleTerm: '102 Infrared Colors',
    plainEnglish: 'The 102 distinct infrared light channels SPHEREx records across every pixel in the sky.',
    scientificContext: 'WCS tabular coordinate axis mapping 102 linear variable filter wavelengths from 0.75 to 5.00 µm.',
  },
  optical_depth: {
    term: 'Optical Depth (τ)',
    simpleTerm: 'Light Blockage',
    plainEnglish: 'How strongly frozen ice or gas molecules absorb and block specific infrared light wavelengths.',
    scientificContext: 'tau(lambda) = -ln(I_obs / I_continuum), directly proportional to molecular column density.',
  },
  proper_motion: {
    term: 'Proper Motion (μ)',
    simpleTerm: 'Speed Across Sky',
    plainEnglish: 'The apparent drift of nearby stars and brown dwarfs across our night sky over years, measured in arcseconds per year.',
    scientificContext: 'Total transverse angular velocity: mu = sqrt((mu_alpha * cos(delta))^2 + mu_delta^2).',
  },
  dipole: {
    term: 'Dipole Signature',
    simpleTerm: 'Black & White Pair',
    plainEnglish: 'A black spot next to a white spot in difference mode. It proves that an object moved from one spot to another between survey passes!',
    scientificContext: 'Spatial flux residual where epoch subtraction leaves negative flux at origin and positive flux at new position.',
  },
  monopole: {
    term: 'Monopole Signature',
    simpleTerm: 'Flashing Spotlight',
    plainEnglish: 'A single point that changes brightness without moving, characteristic of pulsating giants, erupting baby stars, or eclipsing binaries.',
    scientificContext: 'Stationary temporal flux anomaly where position is fixed while magnitude varies by > 0.5 mag.',
  },
  sed: {
    term: 'SED (Spectral Energy Distribution)',
    simpleTerm: 'Color Signature',
    plainEnglish: 'A graph of how much energy a celestial object puts out across different infrared colors, revealing its temperature and composition.',
    scientificContext: 'Broadband photometric flux lambda * F_lambda plotted against wavelength.',
  },
  cosine_similarity: {
    term: 'Cosine Similarity',
    simpleTerm: 'Match Percentage',
    plainEnglish: 'A mathematical score from 0% to 100% telling you how closely a spectrum matches a known library archetype (e.g. brown dwarf).',
    scientificContext: 'Normalized inner product: S = (u . v) / (||u|| * ||v||) computed in <20 ms.',
  },
};

interface JargonTooltipProps {
  termKey: keyof typeof ASTRONOMY_JARGON | string;
  children?: React.ReactNode;
}

export const JargonTooltip: React.FC<JargonTooltipProps> = ({ termKey, children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const def = ASTRONOMY_JARGON[termKey.toLowerCase()] || {
    term: termKey,
    plainEnglish: 'Astronomical terminology used in SPHEREx data processing.',
  };

  return (
    <span
      className="relative inline-flex items-center cursor-help border-b border-dotted border-sky-400 text-sky-300"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      onClick={() => setIsOpen(!isOpen)}
    >
      {children || def.simpleTerm || def.term}
      {isOpen && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 rounded-lg border border-sky-500/40 bg-neutral-950 p-2.5 shadow-2xl z-50 text-left pointer-events-none animate-in fade-in zoom-in-95">
          <span className="block text-xs font-semibold text-sky-200 mb-1">{def.term}</span>
          <span className="block text-[11px] leading-relaxed text-neutral-300">{def.plainEnglish}</span>
          {def.scientificContext && (
            <span className="mt-1.5 block border-t border-neutral-800 pt-1 text-[10px] font-mono text-neutral-400">
              Science detail: {def.scientificContext}
            </span>
          )}
        </span>
      )}
    </span>
  );
};
