import React, { useState, useEffect, useRef } from 'react';
import { useTelemetryStore } from '../../store/useTelemetryStore';
import { useSpectraUrlState } from '../../hooks/useSpectraUrlState';
import { GUIDED_TOURS, GuidedTour, TourStep } from './tutorialScenarios';
import { ASTRONOMY_JARGON, JargonDefinition } from './JargonTooltip';
import { AssistantModelGuidance } from './AssistantModelGuidance';
import { cn } from '../../lib/utils';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

const CANNED_QA: Array<{ trigger: string[]; answer: string; relatedTourId?: string }> = [
  {
    trigger: ['dipole', 'black and white', 'difference', 'moving'],
    answer:
      'In Signed Difference Mode (I_N - I_0), when an object moves between survey passes, subtracting the images leaves a dark trough where it used to be and a bright peak where it moved to. This black-and-white pairing is called a dipole!',
    relatedTourId: 'moving_objects',
  },
  {
    trigger: ['brown dwarf', 'wise', 'y dwarf', 'cold star', 'planet nine'],
    answer:
      'Brown dwarfs are "failed stars" that never got hot enough to fuse hydrogen. They are ultra-cold (<1000 K) and glow faint in visible light, but shine brightly in SPHEREx mid-infrared channels (D4–D6, 3–5 microns).',
    relatedTourId: 'moving_objects',
  },
  {
    trigger: ['ice', 'water', 'co2', 'gas', 'absorption'],
    answer:
      'Cosmic ices like frozen water (3.05 µm) and carbon dioxide (4.27 µm) absorb light at specific molecular vibrational frequencies. In Tab 4 (Ice Studio), you can measure the depth of these dips to calculate how much ice is locked in dust clouds.',
    relatedTourId: 'ice_signatures',
  },
  {
    trigger: ['spherex', 'detectors', 'bands', 'd1', 'd6', 'lvf'],
    answer:
      'SPHEREx carries 6 linear variable filter (LVF) detector arrays spanning 0.75 to 5.00 µm: D1 & D2 (0.75–1.63 µm), D3 & D4 (1.63–3.82 µm), and D5 & D6 (3.82–5.00 µm). Together they provide 102 continuous infrared color channels!',
  },
  {
    trigger: ['proper motion', 'speed', 'arcsec', 'mu'],
    answer:
      'Proper motion (μ) is how fast an astronomical object moves across our night sky over time. It is measured in arcseconds per year. Barnard’s Star is the record holder at 10.39"/year (about 1.68 SPHEREx pixels/year).',
  },
];

export const SpectraAssistantDrawer: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'tours' | 'chat' | 'jargon' | 'guidance'>('tours');
  const [activeTour, setActiveTour] = useState<GuidedTour | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  // Chat conversation state
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: "👋 Hi, Explorer! I'm AstroGuide, your Spectra onboarding co-pilot. I can guide you through step-by-step tours, decode astrophysics jargon, or explain any celestial feature you're looking at.",
    },
  ]);
  const [inputQuestion, setInputQuestion] = useState('');
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Jargon search
  const [jargonQuery, setJargonQuery] = useState('');

  const { setCoordinates, setRenderMode, setRgbPreset } = useTelemetryStore();
  const { setTab, setRa, setDec, setFov, setMode } = useSpectraUrlState();

  // Keyboard shortcut: Press '?' to toggle assistant
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (isInput) return;

      if (e.key === '?') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Scroll chat to bottom
  useEffect(() => {
    if (activeTab === 'chat' && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, activeTab]);

  const handleStartTour = (tour: GuidedTour) => {
    setActiveTour(tour);
    setActiveStepIndex(0);
    executeTourStep(tour.steps[0]);
  };

  const handleNextStep = () => {
    if (!activeTour) return;
    const nextIdx = activeStepIndex + 1;
    if (nextIdx < activeTour.steps.length) {
      setActiveStepIndex(nextIdx);
      executeTourStep(activeTour.steps[nextIdx]);
    } else {
      setActiveTour(null);
      setActiveStepIndex(0);
    }
  };

  const handlePrevStep = () => {
    if (!activeTour || activeStepIndex <= 0) return;
    const prevIdx = activeStepIndex - 1;
    setActiveStepIndex(prevIdx);
    executeTourStep(activeTour.steps[prevIdx]);
  };

  const executeTourStep = (step: TourStep) => {
    if (step.targetTab) {
      setTab(step.targetTab);
    }
    if (step.coordinates) {
      const { ra, dec, name, badge } = step.coordinates;
      setCoordinates(ra, dec, name, badge || '[NASA Benchmark]');
      setRa(ra);
      setDec(dec);
    }
    if (step.renderMode) {
      setRenderMode(step.renderMode);
      setMode(step.renderMode);
    }
    if (step.fov) {
      setFov(step.fov);
    }
  };

  const handleSendMessage = (textToSend?: string) => {
    const q = (textToSend || inputQuestion).trim();
    if (!q) return;

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      sender: 'user',
      text: q,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputQuestion('');

    // Match canned astrophysics knowledge
    const lowerQ = q.toLowerCase();
    const matched = CANNED_QA.find((item) =>
      item.trigger.some((keyword) => lowerQ.includes(keyword))
    );

    setTimeout(() => {
      if (matched) {
        const assistantMsg: ChatMessage = {
          id: `bot_${Date.now()}`,
          sender: 'assistant',
          text: matched.answer,
          action: matched.relatedTourId
            ? {
                label: 'Launch related interactive walkthrough →',
                onClick: () => {
                  const tour = GUIDED_TOURS.find((t) => t.id === matched.relatedTourId);
                  if (tour) handleStartTour(tour);
                },
              }
            : undefined,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        const fallbackMsg: ChatMessage = {
          id: `bot_${Date.now()}`,
          sender: 'assistant',
          text: `You asked about "${q}". SPHEREx observes in 102 infrared bands from 0.75 to 5.00 µm across all survey passes. Try exploring the time-domain comparator or ice studio, or check the Jargon Buster for specific terms!`,
        };
        setMessages((prev) => [...prev, fallbackMsg]);
      }
    }, 400);
  };

  // Filtered jargon
  const filteredJargon = Object.entries(ASTRONOMY_JARGON).filter(([key, def]) => {
    const q = jargonQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      key.includes(q) ||
      def.term.toLowerCase().includes(q) ||
      (def.simpleTerm && def.simpleTerm.toLowerCase().includes(q)) ||
      def.plainEnglish.toLowerCase().includes(q)
    );
  });

  return (
    <>
      {/* Floating Dock Icon (Bottom-Right) */}
      <aside aria-label="AstroGuide Assistant Dock" className="fixed bottom-5 right-5 z-40">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            'group flex items-center gap-2 rounded-full border px-4 py-2.5 text-xs font-semibold shadow-2xl transition-all duration-300 backdrop-blur-md',
            isOpen
              ? 'border-sky-400 bg-sky-500 text-black shadow-sky-500/30'
              : 'border-sky-500/50 bg-black/85 text-sky-200 hover:border-sky-400 hover:bg-neutral-900 hover:text-white shadow-black/80'
          )}
          title="Toggle AstroGuide Assistant (Press ?)"
          aria-expanded={isOpen}
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-400/20 text-sky-300 group-hover:scale-110 transition-transform">
            ✨
          </span>
          <span className="tracking-wide">AstroGuide</span>
          <kbd className="rounded bg-neutral-800/80 px-1 py-0.2 text-[10px] font-mono text-neutral-400 border border-neutral-700">
            ?
          </kbd>
        </button>
      </aside>

      {/* Floating Assistant Drawer */}
      {isOpen && (
        <aside aria-label="AstroGuide Dialog" className="fixed bottom-20 right-5 z-50 flex h-[540px] w-[380px] max-w-[calc(100vw-2.5rem)] flex-col rounded-2xl border border-sky-500/30 bg-neutral-950/95 font-sans text-xs text-foreground shadow-2xl backdrop-blur-xl animate-in slide-in-from-bottom-5">
          {/* Drawer Header */}
          <header className="flex shrink-0 items-center justify-between border-b border-neutral-800 px-4 py-3 bg-neutral-900/60">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-500/20 text-sky-400 text-sm">
                🛰️
              </span>
              <div>
                <h2 className="text-xs font-bold tracking-wide text-white">AstroGuide Assistant</h2>
                <p className="text-[10px] text-neutral-400">Demystifying Astrophysics & SPHEREx</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-full p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors"
              aria-label="Close Assistant"
            >
              ✕
            </button>
          </header>

          {/* Sub-Navigation Tabs */}
          <nav aria-label="AstroGuide sections" className="flex shrink-0 border-b border-neutral-800 bg-neutral-900/30 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('tours')}
              className={cn(
                'flex-1 rounded-lg py-1.5 text-center text-[11px] font-medium transition-colors',
                activeTab === 'tours'
                  ? 'bg-sky-500/20 text-sky-300 font-semibold'
                  : 'text-neutral-400 hover:text-neutral-200'
              )}
            >
              🚀 Guided Tours
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('chat')}
              className={cn(
                'flex-1 rounded-lg py-1.5 text-center text-[11px] font-medium transition-colors',
                activeTab === 'chat'
                  ? 'bg-sky-500/20 text-sky-300 font-semibold'
                  : 'text-neutral-400 hover:text-neutral-200'
              )}
            >
              💬 Ask AI
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('jargon')}
              className={cn(
                'flex-1 rounded-lg py-1.5 text-center text-[11px] font-medium transition-colors',
                activeTab === 'jargon'
                  ? 'bg-sky-500/20 text-sky-300 font-semibold'
                  : 'text-neutral-400 hover:text-neutral-200'
              )}
            >
              📖 Jargon
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('guidance')}
              className={cn(
                'flex-1 rounded-lg py-1.5 text-center text-[11px] font-medium transition-colors',
                activeTab === 'guidance'
                  ? 'bg-sky-500/20 text-sky-300 font-semibold'
                  : 'text-neutral-400 hover:text-neutral-200'
              )}
            >
              🧠 AI Guide
            </button>
          </nav>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-4">
            {/* 1. Guided Tours View */}
            {activeTab === 'tours' && (
              <div className="space-y-4">
                {activeTour ? (
                  /* Active Tour Step Player */
                  <div className="flex flex-col gap-3 rounded-xl border border-sky-500/40 bg-sky-950/20 p-4">
                    <div className="flex items-center justify-between text-[11px] text-sky-300 font-mono">
                      <span>{activeTour.title}</span>
                      <span>
                        Step {activeStepIndex + 1} of {activeTour.steps.length}
                      </span>
                    </div>

                    <h4 className="text-sm font-semibold text-white">
                      {activeTour.steps[activeStepIndex].title}
                    </h4>

                    <p className="text-xs leading-relaxed text-neutral-300">
                      {activeTour.steps[activeStepIndex].explanation}
                    </p>

                    {activeTour.steps[activeStepIndex].actionLabel && (
                      <button
                        type="button"
                        onClick={() => executeTourStep(activeTour.steps[activeStepIndex])}
                        className="mt-1 w-full rounded-lg bg-sky-500 px-3 py-2 text-xs font-semibold text-black hover:bg-sky-400 transition-colors shadow-md"
                      >
                        ⚡ {activeTour.steps[activeStepIndex].actionLabel}
                      </button>
                    )}

                    <div className="mt-3 flex items-center justify-between border-t border-sky-500/20 pt-3">
                      <button
                        type="button"
                        disabled={activeStepIndex === 0}
                        onClick={handlePrevStep}
                        className="rounded px-2.5 py-1 text-xs text-neutral-400 hover:text-white disabled:opacity-30"
                      >
                        ← Previous
                      </button>
                      <button
                        type="button"
                        onClick={handleNextStep}
                        className="rounded bg-neutral-800 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-700"
                      >
                        {activeStepIndex === activeTour.steps.length - 1 ? 'Finish Tour 🎉' : 'Next Step →'}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Tour Selection Cards */
                  <div className="space-y-3">
                    <p className="text-[11px] text-neutral-400">
                      Select an interactive tour to learn how to identify moving objects, detect molecular ices, or contribute candidate data:
                    </p>
                    {GUIDED_TOURS.map((tour) => (
                      <div
                        key={tour.id}
                        className="group flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3.5 hover:border-sky-500/50 hover:bg-neutral-900 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-white group-hover:text-sky-300">
                            {tour.title}
                          </span>
                          <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-mono text-sky-400 border border-sky-500/20">
                            {tour.badge}
                          </span>
                        </div>
                        <p className="text-[11px] text-neutral-400 leading-relaxed">
                          {tour.description}
                        </p>
                        <button
                          type="button"
                          onClick={() => handleStartTour(tour)}
                          className="mt-1 self-start rounded-lg bg-sky-500/20 px-3 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500 hover:text-black transition-colors"
                        >
                          Start Tour ({tour.steps.length} steps) →
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 2. Interactive Chat View */}
            {activeTab === 'chat' && (
              <div className="flex h-full flex-col justify-between">
                <div ref={chatScrollRef} className="flex-1 space-y-3 overflow-y-auto pr-1">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        'flex flex-col gap-1 max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed',
                        msg.sender === 'user'
                          ? 'ml-auto bg-sky-600 text-white'
                          : 'bg-neutral-900 text-neutral-200 border border-neutral-800'
                      )}
                    >
                      <span>{msg.text}</span>
                      {msg.action && (
                        <button
                          type="button"
                          onClick={msg.action.onClick}
                          className="mt-1 rounded bg-sky-500/20 px-2 py-1 text-[11px] font-semibold text-sky-300 hover:bg-sky-500 hover:text-black text-left transition-colors"
                        >
                          {msg.action.label}
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="mt-3 border-t border-neutral-800 pt-3">
                  <div className="mb-2 flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => handleSendMessage('What is a dipole?')}
                      className="rounded-full bg-neutral-900 border border-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400 hover:text-white"
                    >
                      What is a dipole?
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSendMessage('How do I spot brown dwarfs?')}
                      className="rounded-full bg-neutral-900 border border-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400 hover:text-white"
                    >
                      Finding Brown Dwarfs
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSendMessage('What is water ice absorption?')}
                      className="rounded-full bg-neutral-900 border border-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400 hover:text-white"
                    >
                      Molecular Ice Dips
                    </button>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSendMessage();
                    }}
                    className="flex gap-2"
                  >
                    <input
                      type="text"
                      value={inputQuestion}
                      onChange={(e) => setInputQuestion(e.target.value)}
                      placeholder="Ask anything in plain English..."
                      className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:border-sky-500 focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-sky-400 transition-colors"
                    >
                      Send
                    </button>
                  </form>
                </div>
              </div>
            )}

            {/* 3. Jargon Buster Dictionary View */}
            {activeTab === 'jargon' && (
              <div className="space-y-3">
                <input
                  type="text"
                  value={jargonQuery}
                  onChange={(e) => setJargonQuery(e.target.value)}
                  placeholder="Search astronomical terms (e.g. Asinh, MOC, Dipole)..."
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:border-sky-500 focus:outline-none"
                />

                <div className="space-y-2.5">
                  {filteredJargon.map(([key, def]: [string, JargonDefinition]) => (
                    <div
                      key={key}
                      className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-sky-300">{def.term}</span>
                        {def.simpleTerm && (
                          <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-400">
                            {def.simpleTerm}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-neutral-300">
                        {def.plainEnglish}
                      </p>
                      {def.scientificContext && (
                        <p className="mt-1.5 border-t border-neutral-800/80 pt-1 text-[10px] font-mono text-neutral-400">
                          {def.scientificContext}
                        </p>
                      )}
                    </div>
                  ))}
                  {filteredJargon.length === 0 && (
                    <p className="py-4 text-center text-xs text-neutral-500">
                      No matching terms found. Try asking in the AI Chat tab!
                    </p>
                  )}
                </div>
              </div>
            )}
            {/* 4. Model Decision Guidance & Active Learning View (Phase D) */}
            {activeTab === 'guidance' && (
              <div className="space-y-3">
                <AssistantModelGuidance />
              </div>
            )}
          </div>
        </aside>
      )}
    </>
  );
};
