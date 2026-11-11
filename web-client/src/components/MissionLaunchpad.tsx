import React from 'react';
import { MissionHero } from './MissionHero';
import { MajorDiscoveriesShowcase } from './MajorDiscoveriesShowcase';
import { SciencePillarsSection } from './SciencePillarsSection';
import { PatternPrimer } from './PatternPrimer';
import { MajorDiscovery } from './MajorDiscoveriesData';

interface MissionLaunchpadProps {
  onLaunchWorkstation: (tab?: string) => void;
  onSelectDiscovery: (discovery: MajorDiscovery) => void;
}

export const MissionLaunchpad: React.FC<MissionLaunchpadProps> = ({
  onLaunchWorkstation,
  onSelectDiscovery,
}) => {
  return (
    <div className="w-full min-h-screen bg-black text-white font-sans overflow-y-auto">
      {/* 1. Spectra identity, product promise, and mission context */}
      <MissionHero
        onLaunchWorkstation={() => onLaunchWorkstation('navigator')}
      />

      {/* First-use routes into the full workspace; existing sections stay below. */}
      <section aria-labelledby="starter-paths-title" className="border-b border-neutral-900 bg-neutral-950 px-6 py-10 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="mb-5">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Choose a starting point</p>
            <h2 id="starter-paths-title" className="text-xl font-semibold text-white">Explore at your own pace</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <button type="button" onClick={() => onLaunchWorkstation('navigator')} className="group rounded-xl border border-neutral-800 bg-black p-5 text-left transition-colors hover:border-primary/60 hover:bg-neutral-900">
              <span className="mb-2 block text-sm font-semibold text-white group-hover:text-primary">Explore the sky <span aria-hidden="true">→</span></span>
              <span className="block text-xs leading-relaxed text-neutral-400">Open the sky navigator and search for a target or position.</span>
            </button>
            <button type="button" onClick={() => onLaunchWorkstation('comparator')} className="group rounded-xl border border-neutral-800 bg-black p-5 text-left transition-colors hover:border-primary/60 hover:bg-neutral-900">
              <span className="mb-2 block text-sm font-semibold text-white group-hover:text-primary">Compare survey passes <span aria-hidden="true">→</span></span>
              <span className="block text-xs leading-relaxed text-neutral-400">Inspect how observations of the same sky region change over time.</span>
            </button>
            <button type="button" onClick={() => onLaunchWorkstation('discussions')} className="group rounded-xl border border-neutral-800 bg-black p-5 text-left transition-colors hover:border-primary/60 hover:bg-neutral-900">
              <span className="mb-2 block text-sm font-semibold text-white group-hover:text-primary">Discuss candidate evidence <span aria-hidden="true">→</span></span>
              <span className="block text-xs leading-relaxed text-neutral-400">Share observations and compare notes with the community.</span>
            </button>
          </div>
        </div>
      </section>

      {/* 2. Curated discoveries remain available below the first-use actions. */}
      <MajorDiscoveriesShowcase
        onSelectTarget={(discovery) => onSelectDiscovery(discovery)}
      />

      {/* 3. The three science pillars of SPHEREx */}
      <SciencePillarsSection
        onLaunchPillarWorkstation={(pillar) => {
          if (pillar === 'inflation') onLaunchWorkstation('spectral');
          else if (pillar === 'reionization') onLaunchWorkstation('navigator');
          else onLaunchWorkstation('ice');
        }}
      />

      {/* 4. Educational pattern primer */}
      <PatternPrimer />

      {/* 5. Spectra identity with factual mission and archive attribution */}
      <footer className="w-full bg-black py-12 px-6 lg:px-12 border-t border-neutral-900 text-xs text-neutral-500">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex flex-col gap-1">
            <span className="font-semibold tracking-wider text-white">SPECTRA · COMMUNITY PRODUCT</span>
            <span className="text-[11px] text-neutral-400">An independent interface for exploring public SPHEREx survey data.</span>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-[11px]">
            <a
              href="https://science.nasa.gov/mission/spherex/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              NASA SPHEREx Mission
            </a>
            <a
              href="https://spherex.caltech.edu/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              Caltech Science Center
            </a>
            <a
              href="https://irsa.ipac.caltech.edu/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              NASA/IPAC Infrared Science Archive (IRSA)
            </a>
            <button
              type="button"
              onClick={() => onLaunchWorkstation('navigator')}
              className="text-primary hover:underline font-medium"
            >
              Launch Sky Explorer →
            </button>
          </div>
        </div>

        <div className="max-w-7xl mx-auto mt-8 pt-6 border-t border-neutral-900 text-center text-[10px] text-neutral-600">
          SPHEREx is a NASA mission. Spectra is an independent community product and is not affiliated with or endorsed by NASA, JPL, or Caltech. Source links above lead to the mission and archive providers.
        </div>
      </footer>
    </div>
  );
};
