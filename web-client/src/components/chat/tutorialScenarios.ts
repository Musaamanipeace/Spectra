/**
 * Interactive Walkthrough Tours & Onboarding Scenarios ("Spectra Guide")
 * Specification Anchor: Implementation Plan Phase B (Issue B.1)
 */

export interface TourStep {
  title: string;
  explanation: string;
  actionLabel?: string;
  targetTab?: 'navigator' | 'comparator' | 'spectral' | 'ice' | 'discussions';
  coordinates?: { ra: number; dec: number; name: string; badge?: string };
  renderMode?: 'blink' | 'difference' | 'coadd';
  fov?: number;
  highlightSelector?: string;
}

export interface GuidedTour {
  id: string;
  title: string;
  description: string;
  badge: string;
  steps: TourStep[];
}

export const GUIDED_TOURS: GuidedTour[] = [
  {
    id: 'moving_objects',
    title: 'Tour 1: Spotting Fast-Moving Cosmic Objects',
    badge: 'Time-Domain & Dipoles',
    description: "Learn how to detect nearby stars and frozen brown dwarfs darting across SPHEREx's field of view.",
    steps: [
      {
        title: 'Welcome to Time-Domain Astronomy!',
        explanation:
          'Most stars look fixed in the sky, but nearby objects like red dwarfs and rogue brown dwarfs sprint across our field of view over months. Let’s load the fastest-moving star in our galaxy: Barnard’s Star!',
        actionLabel: "Load Barnard's Star in Time-Domain Comparator",
        targetTab: 'comparator',
        coordinates: {
          ra: 269.44639,
          dec: 4.76676,
          name: "Barnard's Star (Speed Demon)",
          badge: '[NASA Benchmark (Pre-cached)]',
        },
        fov: 180,
      },
      {
        title: 'Survey Passes & The Scrubber',
        explanation:
          'Look at the temporal scrubber below the image. SPHEREx maps the sky in discrete 6-month survey passes. Notice how the bright star shifts slightly upward (North) between Pass 1 and Pass 4!',
        targetTab: 'comparator',
      },
      {
        title: 'Activate Difference Mode',
        explanation:
          'Blinking images manually is hard on human eyes. Click "Difference Mode" (or press key 2). This subtracts the first survey pass from the current pass: I_N - I_0.',
        actionLabel: 'Turn on Signed Difference Mode',
        targetTab: 'comparator',
        renderMode: 'difference',
      },
      {
        title: 'The Black & White "Dipole" Signature',
        explanation:
          'See the distinctive black spot paired with a white spot? That is a dipole! The black hole is where the star used to be, and the white spot is where it moved to. A dipole is definitive proof of high proper motion!',
        targetTab: 'comparator',
        renderMode: 'difference',
      },
      {
        title: 'Congratulations, Explorer!',
        explanation:
          "You've learned how professional astronomers and citizen scientists hunt for elusive Planet Nine and undiscovered brown dwarfs. You can now use this on any coordinate in the sky!",
        targetTab: 'comparator',
      },
    ],
  },
  {
    id: 'ice_signatures',
    title: 'Tour 2: Detecting Gas & Molecular Ice Signatures',
    badge: 'Astrochemistry & 102 Colors',
    description: 'Explore the building blocks of planets by measuring frozen water and carbon dioxide in deep space.',
    steps: [
      {
        title: 'Cosmic Freezers: Molecular Ice',
        explanation:
          'In dark stellar nurseries, water (H₂O) and carbon dioxide (CO₂) freeze onto interstellar dust grains. SPHEREx measures 102 distinct infrared colors to detect these molecules.',
        actionLabel: 'Open Molecular & Ice Studio',
        targetTab: 'ice',
        coordinates: {
          ra: 76.95647,
          dec: 30.4013,
          name: 'Taurus Ice Core Field',
          badge: '[NASA Benchmark (Pre-cached)]',
        },
      },
      {
        title: 'The 3.05 µm Water Ice Dip',
        explanation:
          'Observe the spectrum curve. At 3.05 microns, frozen water ice molecules absorb incoming infrared photons, creating a deep canyon-like dip called an absorption trough.',
        targetTab: 'ice',
      },
      {
        title: 'The 4.27 µm Carbon Dioxide Dip',
        explanation:
          'Notice another sharp notch at 4.27 microns! That is frozen CO₂ ice. The deeper this trough is, the more frozen carbon is locked up in the dust cloud.',
        targetTab: 'ice',
      },
      {
        title: 'Measuring Optical Depth (τ)',
        explanation:
          'By comparing the bottom of the dip to the warm background dust continuum, Spectra calculates the Optical Depth (τ). High optical depth means dense, pristine planet-forming material!',
        targetTab: 'ice',
      },
    ],
  },
  {
    id: 'community_science',
    title: 'Tour 3: Participating in Community Science',
    badge: 'Citizen Science & Forum',
    description: 'Learn how to flag candidate discoveries, collaborate with peers, and earn verified badges.',
    steps: [
      {
        title: 'Spotting Something Unusual',
        explanation:
          'When exploring cutouts or difference maps, you will encounter unknown dipoles, variable flashes, or strange spectral spikes.',
        targetTab: 'navigator',
      },
      {
        title: 'Documenting Evidence',
        explanation:
          'Spectra automatically logs your telemetry session headers (X-Observer-ID) with cryptographic zero-auth anonymity—no login required!',
        targetTab: 'discussions',
      },
      {
        title: 'Community Review & Moderator Verification',
        explanation:
          'In Tab 5 (Community Forum), you can submit candidate coordinates, debate hypotheses with other citizen scientists, and receive institutional evaluation from verified moderators.',
        actionLabel: 'Go to Community Forum',
        targetTab: 'discussions',
      },
    ],
  },
];
