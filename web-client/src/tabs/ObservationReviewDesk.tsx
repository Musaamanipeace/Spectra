import React, { useMemo, useState } from 'react';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useSpectraUrlState } from '../hooks/useSpectraUrlState';
import { useRealtimeDiscussions } from '../hooks/useRealtimeDiscussions';
import { Badge, Button, Input } from '../components/ui';

type VoteKey = 'V_mover' | 'V_var' | 'V_ice' | 'V_artifact';
type ForumChannel = 'all' | 'movers' | 'spectra' | 'ices' | 'artifacts' | 'confirmed' | 'discoveries';

interface ReviewReply {
  id: string;
  authorHandle: string;
  isModerator: boolean;
  timestampIso: string;
  body: string;
}

interface ReviewCase {
  id: string;
  title: string;
  authorHandle: string;
  isModerator: boolean;
  timestampIso: string;
  classification: string;
  confidencePct: number;
  ra: number;
  dec: number;
  fovArcsec: number;
  renderMode: 'blink' | 'difference' | 'coadd';
  targetName: string;
  body: string;
  upvotes: number;
  replies: ReviewReply[];
  hashtags?: string[];
  classVotes?: Partial<Record<VoteKey, number>>;
}

interface ClassificationShortcut {
  id: string;
  label: string;
  classification: string;
  hashtag: string;
  voteKey: VoteKey;
  channel: Exclude<ForumChannel, 'all'>;
}

const CATEGORIES = [
  { id: 'moving_brown_dwarf', label: 'Moving source' },
  { id: 'variable_star', label: 'Variable source' },
  { id: 'circumstellar_disk', label: 'Circumstellar disk / dipper' },
  { id: 'mira_agb_pulsator', label: 'AGB / Mira variable' },
  { id: 'interstellar_ice', label: 'Ice / spectral feature' },
  { id: 'high_z_emission', label: 'High-redshift line emitter' },
  { id: 'solar_system_mover', label: 'Solar system mover' },
  { id: 'optical_blend_artifact', label: 'Likely blend or artifact' },
  { id: 'instrumental_flag', label: 'Detector / cosmic-ray artifact' },
];

const SHORTCUTS: ClassificationShortcut[] = [
  { id: 'mover', label: 'Moving source', classification: 'moving_brown_dwarf', hashtag: '#mover', voteKey: 'V_mover', channel: 'movers' },
  { id: 'variable', label: 'Variable source', classification: 'variable_star', hashtag: '#variable', voteKey: 'V_var', channel: 'discoveries' },
  { id: 'ice_source', label: 'Ice / spectral feature', classification: 'interstellar_ice', hashtag: '#ice_source', voteKey: 'V_ice', channel: 'ices' },
  { id: 'blend_artifact', label: 'Likely blend or artifact', classification: 'optical_blend_artifact', hashtag: '#blend_artifact', voteKey: 'V_artifact', channel: 'artifacts' },
];

const CHANNELS: Array<{ value: ForumChannel; label: string }> = [
  { value: 'all', label: 'All channels' },
  { value: 'movers', label: 'Movers' },
  { value: 'spectra', label: 'Spectra' },
  { value: 'ices', label: 'Ices' },
  { value: 'artifacts', label: 'Artifacts' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'discoveries', label: 'Discoveries' },
];

type AssessmentChoice = VoteKey | 'not_sure' | null;

function ensureObserverIdentity() {
  let observerId = localStorage.getItem('spx_observer_id');
  let observerKey = localStorage.getItem('spx_observer_key');
  if (!observerId && typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    observerId = crypto.randomUUID();
    localStorage.setItem('spx_observer_id', observerId);
  }
  if (!observerKey && typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    observerKey = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('spx_observer_key', observerKey);
  }
  if (!observerId || !observerKey) throw new Error('This browser cannot create a secure observer session.');
  return { observerId, observerKey, handle: `Obs-${observerId.replace(/-/g, '').slice(0, 4).toUpperCase()}` };
}

function errorMessage(response: Response, fallback: string) {
  return response.json().then((payload: unknown) => {
    if (typeof payload === 'object' && payload !== null && 'detail' in payload && typeof payload.detail === 'string') {
      return payload.detail;
    }
    return fallback;
  }).catch(() => fallback);
}

function formatCoordinate(ra: number, dec: number) {
  return `RA ${ra.toFixed(5)}° · Dec ${dec >= 0 ? '+' : ''}${dec.toFixed(5)}°`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function angularDistanceDegrees(ra1: number, dec1: number, ra2: number, dec2: number) {
  const radians = Math.PI / 180;
  const dec1Rad = dec1 * radians;
  const dec2Rad = dec2 * radians;
  const deltaRaRad = (ra2 - ra1) * radians;
  const cosine = Math.sin(dec1Rad) * Math.sin(dec2Rad) + Math.cos(dec1Rad) * Math.cos(dec2Rad) * Math.cos(deltaRaRad);
  return Math.acos(Math.max(-1, Math.min(1, cosine))) / radians;
}

function archiveLinks(reviewCase: ReviewCase) {
  const coord = `${reviewCase.ra.toFixed(6)} ${reviewCase.dec >= 0 ? '+' : ''}${reviewCase.dec.toFixed(6)}`;
  const encoded = encodeURIComponent(coord);
  return [
    { label: 'NASA/IPAC IRSA SPHEREx Explorer', href: 'https://irsa.ipac.caltech.edu/applications/spherex/search-spectral-images' },
    { label: 'SIMBAD coordinate search', href: `https://simbad.cds.unistra.fr/simbad/sim-coo?Coord=${encoded}&Radius=2&Radius.unit=arcmin` },
    { label: 'Gaia DR3 in VizieR', href: `https://vizier.cds.unistra.fr/viz-bin/VizieR-4?-source=I/355/gaiadr3&-c=${encoded}&-c.rs=60` },
    { label: 'Pan-STARRS cutouts', href: `https://ps1images.stsci.edu/cgi-bin/ps1cutouts?pos=${encoded}` },
    { label: 'Transient Name Server', href: `https://www.wis-tns.org/search?&ra=${reviewCase.ra.toFixed(5)}&decl=${reviewCase.dec.toFixed(5)}&radius=120&coords_unit=arcsec` },
    { label: 'IRSA ZTF / WISE time-domain archive', href: 'https://irsa.ipac.caltech.edu/irsaviewer/?__action=layout.showDropDown&view=HiPSList' },
  ];
}

export const ObservationReviewDesk: React.FC = () => {
  const { ra, dec, fovArcsec, renderMode, activeTargetName, setCoordinates, setFov, setRenderMode } = useTelemetryStore();
  const { setTab, setRa, setDec, setFov: setUrlFov, setMode: setUrlMode } = useSpectraUrlState();
  const identity = useMemo(() => ensureObserverIdentity(), []);
  const [channelFilter, setChannelFilter] = useState<ForumChannel>('all');
  const { threads, setThreads, sseConnected, loadState, loadError, loadMoreError, loadingMore, hasMore, refreshThreads, loadMoreThreads } =
    useRealtimeDiscussions<ReviewCase>([], channelFilter);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<'all' | 'target'>('all');
  const [classFilter, setClassFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [queueOpen, setQueueOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<'assessment' | 'discussion'>('assessment');
  const [assessmentChoices, setAssessmentChoices] = useState<Record<string, AssessmentChoice>>({});
  const [assessmentPending, setAssessmentPending] = useState(false);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [assessmentFeedback, setAssessmentFeedback] = useState<string | null>(null);
  const [submittedCaseIds, setSubmittedCaseIds] = useState<Set<string>>(() => new Set());
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyPending, setReplyPending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replyFeedback, setReplyFeedback] = useState<string | null>(null);
  const [showNewCase, setShowNewCase] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newClass, setNewClass] = useState('moving_brown_dwarf');
  const [newConfidence, setNewConfidence] = useState(90);
  const [newShortcut, setNewShortcut] = useState<ClassificationShortcut | null>(null);
  const [newCasePending, setNewCasePending] = useState(false);
  const [newCaseError, setNewCaseError] = useState<string | null>(null);

  const visibleCases = useMemo(() => threads.filter((item) => {
    if (scopeFilter === 'target' && angularDistanceDegrees(item.ra, item.dec, ra, dec) > 1.5) return false;
    if (classFilter !== 'all' && item.classification !== classFilter) return false;
    const needle = search.trim().toLowerCase();
    return !needle || `${item.title} ${item.targetName} ${item.authorHandle} ${item.classification}`.toLowerCase().includes(needle);
  }), [classFilter, dec, ra, scopeFilter, search, threads]);

  const selectedCase = threads.find((item) => item.id === selectedCaseId) ?? visibleCases[0] ?? threads[0] ?? null;
  const assessmentChoice = selectedCase ? assessmentChoices[selectedCase.id] ?? null : null;
  const setAssessmentChoice = (choice: AssessmentChoice) => {
    if (selectedCase) setAssessmentChoices((current) => ({ ...current, [selectedCase.id]: choice }));
  };
  const selectedShortcut = SHORTCUTS.find((shortcut) => shortcut.voteKey === assessmentChoice) ?? null;
  const selectedCategory = selectedCase ? CATEGORIES.find((category) => category.id === selectedCase.classification)?.label ?? selectedCase.classification : '';
  const pinnedReplyDraft = selectedCase ? replyDrafts[selectedCase.id] ?? '' : '';
  const sourceLinks = selectedCase ? archiveLinks(selectedCase) : [];
  const hasAssessment = selectedCase ? submittedCaseIds.has(selectedCase.id) : false;

  const restoreCaseInWorkbench = (reviewCase: ReviewCase, destination: 'navigator' | 'comparator') => {
    setCoordinates(reviewCase.ra, reviewCase.dec, reviewCase.targetName, '[Community Product]');
    setRa(reviewCase.ra);
    setDec(reviewCase.dec);
    setFov(reviewCase.fovArcsec);
    setUrlFov(reviewCase.fovArcsec);
    setRenderMode(reviewCase.renderMode);
    setUrlMode(reviewCase.renderMode);
    setTab(destination);
  };

  const submitAssessment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedCase || !selectedShortcut || assessmentPending || hasAssessment) return;
    setAssessmentPending(true);
    setAssessmentError(null);
    setAssessmentFeedback(null);
    try {
      if (!/^\d+$/.test(selectedCase.id)) throw new Error('This case does not have a server ID yet. Refresh the case list and retry.');
      const response = await fetch(`/api/forum/threads/${selectedCase.id}/classifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Observer-ID': identity.observerId, 'X-Observer-Key': identity.observerKey },
        body: JSON.stringify({ classificationVote: selectedShortcut.id }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, 'Your assessment could not be submitted.'));
      const payload = await response.json() as { thread?: Partial<ReviewCase> };
      if (payload.thread) {
        setThreads((current) => current.map((item) => item.id === selectedCase.id ? { ...item, ...payload.thread, id: selectedCase.id } : item));
      } else {
        await refreshThreads();
      }
      setSubmittedCaseIds((current) => new Set(current).add(selectedCase.id));
      setAssessmentFeedback('Assessment submitted. Community classifications are evidence for review, not a confirmed discovery.');
    } catch (error) {
      setAssessmentError(error instanceof Error ? error.message : 'Your assessment could not be submitted.');
    } finally {
      setAssessmentPending(false);
    }
  };

  const submitReply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedCase || !pinnedReplyDraft.trim() || replyPending) return;
    if (!/^\d+$/.test(selectedCase.id)) {
      setReplyError('This case is not available on the server yet. Refresh the case list and retry.');
      return;
    }
    setReplyPending(true);
    setReplyError(null);
    setReplyFeedback(null);
    try {
      const response = await fetch('/api/forum/replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Observer-ID': identity.observerId, 'X-Observer-Key': identity.observerKey },
        body: JSON.stringify({ threadId: Number(selectedCase.id), body: pinnedReplyDraft.trim() }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, 'Your note could not be posted.'));
      setReplyDrafts((current) => ({ ...current, [selectedCase.id]: '' }));
      setReplyFeedback('Your note was posted to this case.');
      await refreshThreads();
    } catch (error) {
      setReplyError(error instanceof Error ? error.message : 'Your note could not be posted. Your draft is still here.');
    } finally {
      setReplyPending(false);
    }
  };

  const createCase = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newTitle.trim() || !newBody.trim() || newCasePending) return;
    setNewCasePending(true);
    setNewCaseError(null);
    const hashtag = newShortcut?.hashtag;
    const body = hashtag && !newBody.includes(hashtag) ? `${newBody.trim()} ${hashtag}` : newBody.trim();
    try {
      const response = await fetch('/api/forum/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Observer-ID': identity.observerId, 'X-Observer-Key': identity.observerKey },
        body: JSON.stringify({
          title: newTitle.trim(), body, classification: newClass, confidencePct: newConfidence,
          ra, dec, fovArcsec, renderMode,
          targetName: activeTargetName || `J2000 ${ra.toFixed(4)}°, ${dec >= 0 ? '+' : ''}${dec.toFixed(4)}°`,
          hashtags: hashtag ? [hashtag] : [], classificationVote: newShortcut?.id ?? null,
          channel: newShortcut?.channel ?? 'discoveries',
        }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, 'The case could not be created.'));
      const payload = await response.json() as { thread?: ReviewCase };
      if (!payload.thread?.id) throw new Error('The server did not return the created case. Refresh the list to check whether it was saved.');
      const created = { ...payload.thread, id: String(payload.thread.id), replies: payload.thread.replies ?? [] };
      setThreads((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setSelectedCaseId(created.id);
      setNewTitle('');
      setNewBody('');
      setNewClass('moving_brown_dwarf');
      setNewConfidence(90);
      setNewShortcut(null);
      setShowNewCase(false);
    } catch (error) {
      setNewCaseError(error instanceof Error ? error.message : 'The case could not be created. Your draft is still here.');
    } finally {
      setNewCasePending(false);
    }
  };

  const browseAllCases = () => {
    setSearch('');
    setScopeFilter('all');
    setClassFilter('all');
    setChannelFilter('all');
    setQueueOpen(true);
  };

  const renderQueue = () => (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-border p-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Review queue</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">{visibleCases.length} loaded in this view</p>
        </div>
        <Button size="xs" variant="secondary" onClick={() => setShowNewCase(true)}>New case</Button>
      </div>
      <div className="space-y-3 border-b border-border p-3">
        <Input aria-label="Search cases" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search cases" className="h-9 bg-background text-xs" />
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-background p-1" role="group" aria-label="Case scope">
          <button type="button" aria-pressed={scopeFilter === 'all'} onClick={() => setScopeFilter('all')} className={`rounded-md px-2 py-2 text-xs ${scopeFilter === 'all' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>All sky</button>
          <button type="button" aria-pressed={scopeFilter === 'target'} onClick={() => setScopeFilter('target')} className={`rounded-md px-2 py-2 text-xs ${scopeFilter === 'target' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>Current field</button>
        </div>
        <label className="block text-[11px] text-muted-foreground" htmlFor="review-channel">Channel</label>
        <select id="review-channel" value={channelFilter} onChange={(event) => setChannelFilter(event.target.value as ForumChannel)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground">
          {CHANNELS.map((channel) => <option key={channel.value} value={channel.value}>{channel.label}</option>)}
        </select>
        <label className="block text-[11px] text-muted-foreground" htmlFor="review-classification">Classification</label>
        <select id="review-classification" value={classFilter} onChange={(event) => setClassFilter(event.target.value)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground">
          <option value="all">All classifications</option>
          {CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
        </select>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2" aria-label="Available cases">
        {loadState === 'loading' && threads.length === 0 && <div className="space-y-2 p-2" aria-label="Loading cases">{[1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-lg bg-neutral-900" />)}</div>}
        {visibleCases.map((item) => {
          const active = selectedCase?.id === item.id;
          return <button key={item.id} type="button" aria-current={active ? 'true' : undefined} onClick={() => { setSelectedCaseId(item.id); setQueueOpen(false); }} className={`w-full rounded-lg border-l-2 p-3 text-left transition-colors ${active ? 'border-primary bg-primary/10 ring-1 ring-inset ring-primary/20' : 'border-transparent hover:bg-neutral-900'}`}>
            <span className="block line-clamp-2 text-xs font-semibold leading-relaxed text-foreground">{item.title}</span>
            <span className="mt-1 block truncate text-[11px] text-muted-foreground">{item.targetName} · {formatCoordinate(item.ra, item.dec)}</span>
            <span className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge variant="sky">{CATEGORIES.find((category) => category.id === item.classification)?.label ?? item.classification}</Badge>
              {item.upvotes > 0 && <span className="text-[10px] text-muted-foreground">{item.upvotes} upvotes</span>}
              {item.replies.length > 0 && <span className="text-[10px] text-muted-foreground">{item.replies.length} notes</span>}
            </span>
          </button>;
        })}
        {loadState === 'error' && <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-3 text-xs text-amber-200"><p>Cases could not be loaded from the forum.</p><p className="mt-1 text-[11px] text-amber-100/70">{loadError}</p><Button className="mt-3" size="xs" variant="outline" onClick={() => void refreshThreads()}>Retry</Button></div>}
        {loadState === 'ready' && visibleCases.length === 0 && <div className="p-3 text-xs text-muted-foreground">No cases match these filters. Adjust the filters or create a new case.</div>}
        {loadState === 'stale' && <div className="m-1 rounded-lg border border-amber-900/60 p-3 text-[11px] text-amber-200">Showing the last loaded case list. Reconnect failed. <button type="button" className="underline" onClick={() => void refreshThreads()}>Retry</button><span className="mt-1 block text-amber-100/70">{loadError}</span></div>}
        {loadMoreError && <p role="alert" className="m-2 text-[11px] text-red-300">{loadMoreError}</p>}
        {hasMore && <Button className="m-1 w-[calc(100%-0.5rem)]" size="sm" variant="outline" disabled={loadingMore} onClick={() => void loadMoreThreads()}>{loadingMore ? 'Loading…' : 'Load more cases'}</Button>}
      </div>
      <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[10px] text-muted-foreground"><span>{sseConnected ? 'Live updates connected' : 'Live updates reconnecting'}</span><button type="button" onClick={() => void refreshThreads()} className="underline">Refresh list</button></div>
    </>
  );

  return <div className="relative flex min-h-[70vh] w-full flex-col bg-background text-foreground md:h-full md:min-h-0 md:flex-row md:overflow-hidden">
    <aside className="hidden w-[280px] shrink-0 flex-col border-r border-border bg-card md:flex">{renderQueue()}</aside>
    {queueOpen && <div className="fixed inset-0 z-50 bg-black/70 md:hidden" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setQueueOpen(false); }}>
      <aside className="flex h-full w-[min(88vw,360px)] flex-col border-r border-border bg-card shadow-2xl" aria-label="Browse cases"><div className="flex items-center justify-between border-b border-border p-3"><span className="text-sm font-semibold">Browse all cases</span><Button size="xs" variant="ghost" onClick={() => setQueueOpen(false)}>Close</Button></div>{renderQueue()}</aside>
    </div>}

    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto md:overflow-y-auto">
      <header className="border-b border-border bg-card px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button type="button" className="rounded-md border border-border px-3 py-2 text-xs md:hidden" onClick={() => setQueueOpen(true)}>Cases</button>
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Spectra · Community Product</p><h1 className="mt-1 text-lg font-semibold">Review Desk</h1></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-[10px] ${sseConnected ? 'border-emerald-800 bg-emerald-950/30 text-emerald-300' : 'border-neutral-700 text-neutral-400'}`} role="status">{sseConnected ? 'Connected' : 'Reconnecting'}</span>
            <Button size="sm" variant="outline" onClick={browseAllCases}>Browse all cases</Button>
            <Button size="sm" onClick={() => setShowNewCase(true)}>New case</Button>
          </div>
        </div>
      </header>

      {selectedCase ? <>
        <section className="space-y-4 p-4 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><div className="mb-2 flex flex-wrap gap-2"><Badge variant="sky">Community case</Badge><Badge variant="outline">Source metadata unavailable</Badge></div><h2 className="max-w-4xl text-xl font-semibold leading-snug md:text-2xl">{selectedCase.title}</h2><p className="mt-2 font-mono text-xs text-muted-foreground">{selectedCase.targetName} · {formatCoordinate(selectedCase.ra, selectedCase.dec)} · FoV {selectedCase.fovArcsec}&quot;</p></div>
            <div className="flex shrink-0 flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => restoreCaseInWorkbench(selectedCase, 'comparator')}>Open in TimeLens</Button><Button size="sm" variant="secondary" onClick={() => setActivePanel('discussion')}>Discuss this case</Button></div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-3"><span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Classification</span><span className="mt-1 block text-sm font-medium">{selectedCategory || 'Unclassified'}</span></div>
            <div className="rounded-lg border border-border bg-card p-3"><span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Saved view</span><span className="mt-1 block text-sm font-medium capitalize">{selectedCase.renderMode}</span></div>
            <div className="rounded-lg border border-border bg-card p-3"><span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Case author</span><span className="mt-1 flex items-center gap-2 text-sm font-medium">{selectedCase.authorHandle}{selectedCase.isModerator && <Badge variant="amber">[Moderator]</Badge>}</span></div>
            <div className="rounded-lg border border-border bg-card p-3"><span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Posted</span><span className="mt-1 block text-sm font-medium">{formatDate(selectedCase.timestampIso)}</span></div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Observation context</h3><p className="mt-1 text-xs text-muted-foreground">Case details are supplied by its author; survey evidence is not embedded in the forum record.</p></div><Button size="sm" variant="outline" onClick={() => restoreCaseInWorkbench(selectedCase, 'comparator')}>Load saved view in TimeLens →</Button></div>
            <div className="mt-4 rounded-lg border border-dashed border-neutral-700 bg-background p-4"><p className="text-sm font-medium">No observation pair is attached to this case.</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">The saved view records a sky position and rendering mode, but it does not include resolved exposures, dates, wavelength bands, or a science image. Open TimeLens to inspect available observations for this field.</p><div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground"><span>RA {selectedCase.ra.toFixed(6)}°</span><span>Dec {selectedCase.dec.toFixed(6)}°</span><span>Field {selectedCase.fovArcsec}&quot;</span><span>Mode {selectedCase.renderMode}</span></div></div>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{selectedCase.body}</p>
            <details className="mt-4 rounded-lg border border-border bg-background p-3">
              <summary className="cursor-pointer text-xs font-semibold">Evidence &amp; provenance</summary>
              <div className="mt-3 space-y-3 text-xs text-muted-foreground"><p>Data source, observation IDs, band, processing state, and quality flags were not supplied in this forum case.</p><p>Saved rendering state: <span className="font-mono text-foreground">{selectedCase.renderMode}</span>. Hashtags: {selectedCase.hashtags?.length ? selectedCase.hashtags.join(' ') : 'none supplied'}.</p><div><p className="mb-2 font-semibold text-foreground">External archive cross-matches · {formatCoordinate(selectedCase.ra, selectedCase.dec)}</p><ul className="grid gap-2 sm:grid-cols-2">{sourceLinks.map((link) => <li key={link.label}><a className="text-primary underline-offset-2 hover:underline" href={link.href} target="_blank" rel="noopener noreferrer">{link.label} ↗</a></li>)}</ul></div></div>
            </details>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-3 text-[11px] text-muted-foreground"><span>Posted by <strong className="font-mono text-foreground">{selectedCase.authorHandle}</strong> · {selectedCase.replies.length} case notes</span><span>Observer session: {identity.handle}</span></div>
        </section>

        <aside className="border-t border-border bg-card md:hidden">
          <div className="grid grid-cols-2 gap-1 p-2" role="tablist" aria-label="Case panels"><button type="button" role="tab" aria-selected={activePanel === 'assessment'} onClick={() => setActivePanel('assessment')} className={`min-h-11 rounded-md text-xs ${activePanel === 'assessment' ? 'bg-primary text-white' : 'text-muted-foreground'}`}>Assessment</button><button type="button" role="tab" aria-selected={activePanel === 'discussion'} onClick={() => setActivePanel('discussion')} className={`min-h-11 rounded-md text-xs ${activePanel === 'discussion' ? 'bg-primary text-white' : 'text-muted-foreground'}`}>Discussion ({selectedCase.replies.length})</button></div>
          {activePanel === 'assessment' ? <AssessmentPanel selectedCase={selectedCase} choice={assessmentChoice} setChoice={setAssessmentChoice} selectedShortcut={selectedShortcut} pending={assessmentPending} alreadySubmitted={hasAssessment} error={assessmentError} feedback={assessmentFeedback} onSubmit={submitAssessment} /> : <DiscussionPanel reviewCase={selectedCase} observerHandle={identity.handle} draft={pinnedReplyDraft} setDraft={(value) => setReplyDrafts((current) => ({ ...current, [selectedCase.id]: value }))} pending={replyPending} error={replyError} feedback={replyFeedback} onSubmit={submitReply} />}
        </aside>
      </> : <section className="m-auto max-w-lg p-6 text-center"><h2 className="text-lg font-semibold">No review cases yet</h2><p className="mt-2 text-sm text-muted-foreground">Cases are loaded from the community forum. Explore the sky or create a case from the current workspace.</p><div className="mt-4 flex justify-center gap-2"><Button variant="outline" onClick={() => setTab('navigator')}>Open Navigator</Button><Button onClick={() => setShowNewCase(true)}>Create a case</Button></div>{loadState === 'error' && <p className="mt-3 text-xs text-amber-300">{loadError}</p>}</section>}
    </main>

    {selectedCase && <aside className="hidden w-[320px] shrink-0 flex-col border-l border-border bg-card xl:flex">
      <div className="grid grid-cols-2 gap-1 border-b border-border p-2" role="tablist" aria-label="Case panels"><button type="button" role="tab" aria-selected={activePanel === 'assessment'} onClick={() => setActivePanel('assessment')} className={`min-h-10 rounded-md text-xs ${activePanel === 'assessment' ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-neutral-900'}`}>Assessment</button><button type="button" role="tab" aria-selected={activePanel === 'discussion'} onClick={() => setActivePanel('discussion')} className={`min-h-10 rounded-md text-xs ${activePanel === 'discussion' ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-neutral-900'}`}>Discussion ({selectedCase.replies.length})</button></div>
      {activePanel === 'assessment' ? <AssessmentPanel selectedCase={selectedCase} choice={assessmentChoice} setChoice={setAssessmentChoice} selectedShortcut={selectedShortcut} pending={assessmentPending} alreadySubmitted={hasAssessment} error={assessmentError} feedback={assessmentFeedback} onSubmit={submitAssessment} /> : <DiscussionPanel reviewCase={selectedCase} observerHandle={identity.handle} draft={pinnedReplyDraft} setDraft={(value) => setReplyDrafts((current) => ({ ...current, [selectedCase.id]: value }))} pending={replyPending} error={replyError} feedback={replyFeedback} onSubmit={submitReply} />}
    </aside>}

    {showNewCase && <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !newCasePending) setShowNewCase(false); }}>
      <form onSubmit={createCase} role="dialog" aria-modal="true" aria-labelledby="new-case-title" className="max-h-[95vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-t-xl border border-border bg-card p-5 shadow-2xl sm:rounded-xl">
        <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-widest text-primary">Current scientific context</p><h2 id="new-case-title" className="mt-1 text-lg font-semibold">Create a community case</h2><p className="mt-1 text-xs text-muted-foreground">Pinned to {activeTargetName || 'selected field'} · {formatCoordinate(ra, dec)} · {fovArcsec}&quot; · {renderMode}</p></div><Button type="button" size="xs" variant="ghost" disabled={newCasePending} onClick={() => setShowNewCase(false)}>Close</Button></div>
        <div className="flex flex-wrap gap-2" aria-label="Structured classification shortcuts">{SHORTCUTS.map((shortcut) => <button key={shortcut.id} type="button" aria-pressed={newShortcut?.id === shortcut.id} onClick={() => { setNewShortcut(shortcut); setNewClass(shortcut.classification); }} className={`min-h-11 rounded-lg border px-3 text-xs ${newShortcut?.id === shortcut.id ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:border-primary/60'}`}>{shortcut.label}</button>)}</div>
        <label className="block text-xs text-muted-foreground" htmlFor="new-case-title-input">Case question / title<Input id="new-case-title-input" required maxLength={120} value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="What should others inspect?" className="mt-1 bg-background text-sm" /></label>
        <label className="block text-xs text-muted-foreground" htmlFor="new-case-class">Classification<select id="new-case-class" value={newClass} onChange={(event) => { setNewClass(event.target.value); setNewShortcut(null); }} className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground">{CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
        <label className="block text-xs text-muted-foreground" htmlFor="new-case-confidence">Author confidence ({newConfidence}%)<input id="new-case-confidence" type="range" min={0} max={100} step={5} value={newConfidence} onChange={(event) => setNewConfidence(Number(event.target.value))} className="mt-2 block w-full accent-primary" /></label>
        <label className="block text-xs text-muted-foreground" htmlFor="new-case-body">Observation notes<textarea id="new-case-body" required maxLength={4000} rows={5} value={newBody} onChange={(event) => setNewBody(event.target.value)} placeholder="Include the epoch, band, coordinate, or processing detail you mean." className="mt-1 w-full rounded-md border border-border bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" /></label>
        <p className="text-[11px] text-muted-foreground">Case source is not inferred. Include supporting context in your notes; the case will be labelled as community-provided.</p>
        {newCaseError && <p role="alert" className="text-xs text-red-300">{newCaseError}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={newCasePending} onClick={() => setShowNewCase(false)}>Cancel</Button><Button type="submit" disabled={newCasePending || !newTitle.trim() || !newBody.trim()}>{newCasePending ? 'Publishing…' : 'Create case'}</Button></div>
      </form>
    </div>}
  </div>;
};

interface AssessmentPanelProps {
  selectedCase: ReviewCase;
  choice: AssessmentChoice;
  setChoice: (choice: AssessmentChoice) => void;
  selectedShortcut: ClassificationShortcut | null;
  pending: boolean;
  alreadySubmitted: boolean;
  error: string | null;
  feedback: string | null;
  onSubmit: (event: React.FormEvent) => void;
}

const AssessmentPanel: React.FC<AssessmentPanelProps> = ({ selectedCase, choice, setChoice, selectedShortcut, pending, alreadySubmitted, error, feedback, onSubmit }) => {
  const votes = selectedCase.classVotes;
  return <div className="space-y-4 p-4">
    <div><p className="text-[10px] font-semibold uppercase tracking-widest text-primary">Your assessment</p><h2 className="mt-1 text-sm font-semibold">What best describes this source?</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Use evidence you can inspect. You can open this case in TimeLens to examine available observations.</p></div>
    <form onSubmit={onSubmit}>
      <fieldset disabled={pending || alreadySubmitted} className="space-y-2"><legend className="sr-only">Choose an assessment</legend>{[...SHORTCUTS.map((item) => ({ key: item.voteKey as AssessmentChoice, label: item.label, voteKey: item.voteKey })), { key: 'not_sure' as AssessmentChoice, label: 'Not sure yet', voteKey: null }].map((item) => <label key={item.key} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border p-3 text-xs ${choice === item.key ? 'border-primary bg-primary/10' : 'border-border hover:border-neutral-600'}`}><input type="radio" name="case-assessment" value={item.key ?? ''} checked={choice === item.key} onChange={() => setChoice(item.key)} className="h-4 w-4 accent-primary" /><span className="flex-1">{item.label}</span>{item.voteKey && votes && votes[item.voteKey] !== undefined && <span className="font-mono text-[10px] text-muted-foreground">{votes[item.voteKey]} signals</span>}</label>)}</fieldset>
      {choice === 'not_sure' && <p className="mt-2 text-[11px] text-muted-foreground">No vote will be sent. You can still read the case discussion or return after inspecting the data.</p>}
      <Button type="submit" className="mt-4 min-h-11 w-full" disabled={pending || alreadySubmitted || !selectedShortcut}>{pending ? 'Submitting…' : alreadySubmitted ? 'Assessment submitted' : 'Submit assessment'}</Button>
    </form>
    {votes && SHORTCUTS.some((item) => votes[item.voteKey] !== undefined) && <div className="rounded-lg border border-border bg-background p-3"><h3 className="text-[11px] font-semibold">Community signals</h3><ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">{SHORTCUTS.map((item) => votes[item.voteKey] === undefined ? null : <li key={item.voteKey} className="flex justify-between gap-2"><span>{item.label}</span><span className="font-mono text-foreground">{votes[item.voteKey]}</span></li>)}</ul><p className="mt-2 text-[10px] text-muted-foreground">Counts are shown only when returned by the forum.</p></div>}
    {error && <p role="alert" className="text-xs text-red-300">{error} Select Submit assessment to retry.</p>}
    {feedback && <p role="status" className="text-xs text-emerald-300">{feedback}</p>}
    <p className="border-t border-border pt-3 text-[10px] leading-relaxed text-muted-foreground">A community classification is evidence for review. It does not confirm a discovery or replace expert validation.</p>
  </div>;
};

interface DiscussionPanelProps {
  reviewCase: ReviewCase;
  observerHandle: string;
  draft: string;
  setDraft: (value: string) => void;
  pending: boolean;
  error: string | null;
  feedback: string | null;
  onSubmit: (event: React.FormEvent) => void;
}

const DiscussionPanel: React.FC<DiscussionPanelProps> = ({ reviewCase, observerHandle, draft, setDraft, pending, error, feedback, onSubmit }) => <div className="flex min-h-[320px] flex-col p-4 xl:min-h-0 xl:flex-1">
  <div className="border-b border-border pb-3"><p className="text-[10px] font-semibold uppercase tracking-widest text-primary">Case notes</p><h2 className="mt-1 line-clamp-2 text-sm font-semibold">{reviewCase.title}</h2><p className="mt-1 text-[11px] text-muted-foreground">Asynchronous discussion · {reviewCase.replies.length} replies</p></div>
  <div className="min-h-40 flex-1 space-y-3 overflow-y-auto py-3" aria-label="Case discussion">
    <article className="rounded-lg border border-border bg-background p-3"><div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground"><strong className="font-mono text-foreground">{reviewCase.authorHandle}</strong>{reviewCase.isModerator && <Badge variant="amber">[Moderator]</Badge>}<time dateTime={reviewCase.timestampIso}>{formatDate(reviewCase.timestampIso)}</time></div><p className="mt-2 text-xs leading-relaxed">{reviewCase.body}</p></article>
    {reviewCase.replies.map((reply) => <article key={reply.id} className="rounded-lg border border-border p-3"><div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground"><strong className="font-mono text-foreground">{reply.authorHandle}</strong>{reply.isModerator && <Badge variant="amber">[Moderator]</Badge>}<time dateTime={reply.timestampIso}>{formatDate(reply.timestampIso)}</time></div><p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed">{reply.body}</p></article>)}
    {reviewCase.replies.length === 0 && <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">No case notes yet. Ask a focused question or share the epoch, band, or coordinate you mean.</p>}
  </div>
  <form onSubmit={onSubmit} className="border-t border-border pt-3"><label htmlFor={`reply-${reviewCase.id}`} className="text-[11px] font-medium">Add a case note</label><textarea id={`reply-${reviewCase.id}`} value={draft} maxLength={2000} onChange={(event) => setDraft(event.target.value)} placeholder="Include the epoch, band, or coordinate you mean." rows={3} className="mt-2 w-full rounded-lg border border-border bg-background p-3 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" /><div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{draft.length}/2000 characters</span><span>Posting as {observerHandle}</span></div><Button type="submit" className="mt-3 min-h-11 w-full" disabled={pending || !draft.trim()}>{pending ? 'Posting…' : 'Post note'}</Button>{error && <p role="alert" className="mt-2 text-xs text-red-300">{error} Your draft is still saved here.</p>}{feedback && <p role="status" className="mt-2 text-xs text-emerald-300">{feedback}</p>}</form>
</div>;
