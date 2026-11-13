import React, { useState, useMemo } from 'react';
import { MAJOR_DISCOVERIES, MajorDiscovery } from './MajorDiscoveriesData';
import { SEARCHABLE_SKY_CATALOG, BenchmarkPill } from './GlobalCommandHeader';

export interface CatalogTarget {
  id: string;
  name: string;
  designation: string;
  classification: string;
  humanCategory: 'movers' | 'cold_worlds' | 'variables' | 'galaxies' | 'all';
  categoryLabel: string;
  ra: number;
  dec: number;
  motionRate: string;
  infraredProfile: string;
  status: string;
  narrative: string;
  preset: 'true_nir' | 'brown_dwarf' | 'water_ice' | 'comet_outgassing' | 'custom';
  launchTab: 'comparator' | 'spectral' | 'ice' | 'navigator';
}

// Transform major discoveries and search catalog into a unified, zero-jargon source catalog
export const UNIFIED_CATALOG_TARGETS: CatalogTarget[] = [
  ...MAJOR_DISCOVERIES.map((d) => {
    let humanCat: CatalogTarget['humanCategory'] = 'all';
    if (d.category === 'nearby_worlds') {
      humanCat = d.motionRate && !d.motionRate.includes('<0.1') ? 'movers' : 'cold_worlds';
    } else if (d.category === 'water_ices' || d.category === 'variables') {
      humanCat = 'variables';
    } else {
      humanCat = 'galaxies';
    }

    return {
      id: d.id,
      name: d.name,
      designation: d.codename || d.name,
      classification: d.spectralType || d.categoryLabel,
      humanCategory: humanCat,
      categoryLabel: d.categoryLabel,
      ra: d.ra,
      dec: d.dec,
      motionRate: d.motionRate || 'Stationary (<0.1" per year)',
      infraredProfile: d.spectralBands || 'Mid-Infrared & Near-Infrared',
      status: d.isMandatoryBenchmark ? 'Verified NASA Standard' : 'Survey Discovery',
      narrative: d.narrative,
      preset: d.preset,
      launchTab: d.launchTab,
    };
  }),
  // Additional catalog targets from SEARCHABLE_SKY_CATALOG not already in MAJOR_DISCOVERIES
  {
    id: 'trappist1',
    name: 'TRAPPIST-1',
    designation: '2MASS J23062928-0502285',
    classification: 'Seven-Planet Ultra-Cool Red Dwarf',
    humanCategory: 'movers',
    categoryLabel: 'Exoplanet System',
    ra: 346.62233,
    dec: -5.04144,
    motionRate: '1.10" per year (Steady West)',
    infraredProfile: 'Infrared Continuum with Water Absorption',
    status: 'Verified NASA Standard',
    narrative: 'A compact system of seven Earth-sized rocky planets orbiting an ultra-cool red dwarf star just 40 light-years away.',
    preset: 'brown_dwarf',
    launchTab: 'comparator',
  },
  {
    id: 'm82_cigar',
    name: 'Cigar Galaxy (M82)',
    designation: 'NGC 3034 / Arp 337',
    classification: 'Explosive Starburst Galaxy',
    humanCategory: 'galaxies',
    categoryLabel: 'Deep Space Galaxy',
    ra: 148.96846,
    dec: 69.6797,
    motionRate: 'Stationary (<0.01" per year)',
    infraredProfile: 'Intense Organic PAH Dust Emission',
    status: 'Survey Discovery',
    narrative: 'A galaxy undergoing a frantic burst of star formation, shooting massive plumes of hot gas and dust into deep intergalactic space.',
    preset: 'water_ice',
    launchTab: 'comparator',
  },
  {
    id: 'ngc253_sculptor',
    name: 'Sculptor Galaxy (NGC 253)',
    designation: 'Silver Coin Galaxy',
    classification: 'Dusty Star-Forming Spiral',
    humanCategory: 'galaxies',
    categoryLabel: 'Deep Space Galaxy',
    ra: 11.88806,
    dec: -25.28822,
    motionRate: 'Stationary (<0.01" per year)',
    infraredProfile: 'Heavy Interstellar Dust Lanes',
    status: 'Survey Discovery',
    narrative: 'One of the brightest spiral galaxies in the southern sky, wrapped in thick dust curtains where hundreds of new stars are born.',
    preset: 'water_ice',
    launchTab: 'comparator',
  },
  {
    id: 'taurus_ice_core',
    name: 'Taurus Molecular Cloud Core',
    designation: 'TMC-1 Prestellar Core',
    classification: 'Deep Interstellar Ice Sanctuary',
    humanCategory: 'variables',
    categoryLabel: 'Molecular Ice Core',
    ra: 68.98,
    dec: 25.75,
    motionRate: 'Stationary (<0.01" per year)',
    infraredProfile: 'Deep 3.05 µm H2O & 4.27 µm CO2 Ice Troughs',
    status: 'Verified NASA Standard',
    narrative: 'A dark, frozen stellar nursery where pristine water, carbon dioxide, and carbon monoxide ices freeze onto interstellar grains.',
    preset: 'water_ice',
    launchTab: 'ice',
  },
];

interface CandidateCatalogDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTarget: (target: CatalogTarget) => void;
  activeRa: number;
  activeDec: number;
}

export const CandidateCatalogDrawer: React.FC<CandidateCatalogDrawerProps> = ({
  isOpen,
  onClose,
  onSelectTarget,
  activeRa,
  activeDec,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<CatalogTarget['humanCategory']>('all');

  // Filtered target list
  const filteredTargets = useMemo(() => {
    return UNIFIED_CATALOG_TARGETS.filter((t) => {
      const matchesCategory =
        selectedCategory === 'all' || t.humanCategory === selectedCategory;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        t.name.toLowerCase().includes(q) ||
        t.designation.toLowerCase().includes(q) ||
        t.classification.toLowerCase().includes(q) ||
        t.narrative.toLowerCase().includes(q) ||
        t.motionRate.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [searchQuery, selectedCategory]);

  // Export catalog as CSV (standard astronomical practice)
  const handleExportCsv = () => {
    const headers = [
      'Name',
      'Designation',
      'Classification',
      'RA_J2000_deg',
      'Dec_J2000_deg',
      'Motion_Rate',
      'Infrared_Profile',
      'Status',
    ];
    const rows = filteredTargets.map((t) => [
      `"${t.name}"`,
      `"${t.designation}"`,
      `"${t.classification}"`,
      t.ra.toFixed(5),
      t.dec.toFixed(5),
      `"${t.motionRate}"`,
      `"${t.infraredProfile}"`,
      `"${t.status}"`,
    ]);
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'SPHEREx_Source_Catalog.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="relative flex h-[85vh] w-[95vw] max-w-6xl flex-col rounded-2xl border border-neutral-800 bg-neutral-950 shadow-2xl overflow-hidden font-sans text-white">
        {/* Header Strip */}
        <div className="flex flex-wrap items-center justify-between border-b border-neutral-800 bg-neutral-900/60 px-6 py-4">
          <div className="flex items-center space-x-3">
            <span className="flex h-3 w-3 items-center justify-center rounded-full bg-primary/20">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            </span>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-white">
                SPHEREx Astronomical Source Catalog
              </h2>
              <p className="text-xs text-neutral-400">
                Authoritative library of {UNIFIED_CATALOG_TARGETS.length} calibrated targets across the infrared sky. Select any object to inspect.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={handleExportCsv}
              className="rounded-lg border border-neutral-700 bg-neutral-800/80 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:border-neutral-500 hover:text-white transition-colors"
              title="Download catalog as CSV table"
            >
              Export Catalog (CSV)
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-400 hover:border-neutral-700 hover:text-white transition-colors"
            >
              Close [Esc]
            </button>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 bg-neutral-950/80 px-6 py-3">
          {/* Plain English Category Tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'all', label: `All Objects (${UNIFIED_CATALOG_TARGETS.length})` },
              { id: 'movers', label: 'Fast-Moving Stars' },
              { id: 'cold_worlds', label: 'Freezing Brown Dwarfs' },
              { id: 'variables', label: 'Variable Stars & Dust' },
              { id: 'galaxies', label: 'Galaxies & Deep Space' },
            ].map((cat) => {
              const active = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id as any)}
                  className={`rounded-lg px-3 py-1.5 text-xs transition-all ${
                    active
                      ? 'border border-primary bg-primary/20 font-semibold text-white shadow-sm'
                      : 'border border-neutral-800 bg-neutral-900/40 text-neutral-400 hover:border-neutral-700 hover:text-white'
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>

          {/* Search Box */}
          <div className="relative min-w-[260px] flex-1 max-w-sm">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by star, galaxy, or designation..."
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900/90 px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:border-primary focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1.5 text-xs text-neutral-400 hover:text-white"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Data Table */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full border-collapse text-left font-sans text-xs">
            <thead className="sticky top-0 z-10 border-b border-neutral-800 bg-neutral-900/95 font-semibold text-neutral-400 uppercase tracking-wider text-[11px] backdrop-blur">
              <tr>
                <th className="py-3 pl-6 pr-3">Target &amp; Designation</th>
                <th className="py-3 px-3">Object Type</th>
                <th className="py-3 px-3">Sky Position (J2000)</th>
                <th className="py-3 px-3">Speed Across Sky</th>
                <th className="py-3 px-3">Infrared Profile</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 pl-3 pr-6 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/60">
              {filteredTargets.map((target) => {
                const isSelected =
                  Math.abs(target.ra - activeRa) < 0.05 &&
                  Math.abs(target.dec - activeDec) < 0.05;

                return (
                  <tr
                    key={target.id}
                    onClick={() => onSelectTarget(target)}
                    className={`cursor-pointer transition-colors duration-150 ${
                      isSelected
                        ? 'bg-primary/15 hover:bg-primary/20'
                        : 'hover:bg-neutral-900/60'
                    }`}
                  >
                    {/* Target & Designation */}
                    <td className="py-3 pl-6 pr-3">
                      <div className="font-semibold text-white flex items-center space-x-2">
                        <span>{target.name}</span>
                        {isSelected && (
                          <span className="rounded-full bg-primary/20 border border-primary/50 px-2 py-0.2 text-[9px] font-mono text-primary">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[10px] text-neutral-400 mt-0.5">
                        {target.designation}
                      </div>
                    </td>

                    {/* Object Type */}
                    <td className="py-3 px-3">
                      <span className="font-medium text-neutral-200">
                        {target.classification}
                      </span>
                    </td>

                    {/* Sky Position */}
                    <td className="py-3 px-3 font-mono tabular-nums text-neutral-300 text-[11px]">
                      RA {target.ra.toFixed(4)}° · Dec {target.dec >= 0 ? `+${target.dec.toFixed(4)}` : target.dec.toFixed(4)}°
                    </td>

                    {/* Speed Across Sky */}
                    <td className="py-3 px-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-medium ${
                          target.motionRate.includes('Fast') || target.motionRate.includes('+10.39') || target.motionRate.includes('8.15')
                            ? 'border border-amber-500/40 bg-amber-500/10 text-amber-300'
                            : 'border border-neutral-800 bg-neutral-900/60 text-neutral-400'
                        }`}
                      >
                        {target.motionRate}
                      </span>
                    </td>

                    {/* Infrared Profile */}
                    <td className="py-3 px-3 text-neutral-300 text-[11px]">
                      {target.infraredProfile}
                    </td>

                    {/* Status */}
                    <td className="py-3 px-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium border ${
                          target.status === 'Verified NASA Standard'
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                            : 'border-neutral-800 bg-neutral-900/60 text-neutral-400'
                        }`}
                      >
                        {target.status}
                      </span>
                    </td>

                    {/* Action */}
                    <td className="py-3 pl-3 pr-6 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectTarget(target);
                        }}
                        className={`rounded-lg border px-3 py-1 text-xs font-semibold transition-all ${
                          isSelected
                            ? 'border-primary bg-primary text-white shadow-sm'
                            : 'border-neutral-700 bg-neutral-800/80 text-neutral-200 hover:border-primary hover:text-white'
                        }`}
                      >
                        Inspect Object →
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredTargets.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-neutral-500">
                    No matching astronomical targets found. Try adjusting your search query.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Summary Strip */}
        <div className="flex items-center justify-between border-t border-neutral-800 bg-neutral-900/40 px-6 py-2.5 text-xs text-neutral-400">
          <span>
            Showing <strong className="text-white">{filteredTargets.length}</strong> of{' '}
            <strong className="text-white">{UNIFIED_CATALOG_TARGETS.length}</strong> catalog targets.
          </span>
          <span className="text-[11px] text-neutral-500 font-mono">
            Standard J2000 Celestial Coordinates · SPHEREx All-Sky Survey Pipeline
          </span>
        </div>
      </div>
    </div>
  );
};