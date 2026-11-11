import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Input, Select, Badge } from '../components/ui';
import { AdminDataState } from './AdminDataState';

interface TriageCase {
  subject_id: string;
  title: string;
  ra: number;
  dec: number;
  category: string;
  ai_predicted_class: string;
  ai_probabilities: Record<string, number>;
  ai_anomaly_score: number;
  consensus_class: string | null;
  consensus_score: number;
  shannon_entropy: number;
  classification_count: number;
  verification_status: string;
  data_release: string;
  ai_explanation: string;
  created_at: string | null;
  vote_count: number;
}

export const HardNegativeTriageLive: React.FC = () => {
  const [cases, setCases] = useState<TriageCase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 8000);
    setLoading(true);
    fetch('/api/admin/triage?limit=200', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Triage request failed (${response.status})`);
        return response.json();
      })
      .then((payload) => {
        const nextCases = Array.isArray(payload?.cases) ? payload.cases as TriageCase[] : [];
        setCases(nextCases);
        setSelectedId((current) => nextCases.some((item) => item.subject_id === current) ? current : nextCases[0]?.subject_id ?? null);
        setError(null);
      })
      .catch((cause) => {
        if (controller.signal.aborted && !timedOut) return;
        setCases([]);
        setError(timedOut ? 'Triage request timed out' : cause instanceof Error ? cause.message : 'Triage records are unavailable');
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (!controller.signal.aborted || timedOut) setLoading(false);
      });
    return () => controller.abort();
  }, [refresh]);

  const filteredCases = useMemo(() => cases.filter((item) => {
    const text = `${item.subject_id} ${item.title} ${item.category} ${item.ai_predicted_class} ${item.consensus_class ?? ''}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase())) && (classFilter === 'all' || item.consensus_class === classFilter);
  }), [cases, classFilter, query]);
  const selected = filteredCases.find((item) => item.subject_id === selectedId) ?? filteredCases[0];

  if (loading && cases.length === 0) {
    return <AdminDataState title="Loading triage records" loading />;
  }
  if (error && cases.length === 0) {
    return (
      <section className="flex h-full min-h-72 items-center justify-center p-6" aria-live="polite">
        <div className="max-w-lg rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Triage records unavailable</h2>
          <p className="mt-2 text-sm text-muted-foreground">{error}. The queue is read-only until a server-authorized review endpoint is available.</p>
          <button type="button" className="mt-4 rounded-md border border-border px-3 py-2 text-xs hover:bg-secondary" onClick={() => setRefresh((value) => value + 1)}>Retry request</button>
        </div>
      </section>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Read-only case review</p>
          <h2 className="mt-1 text-lg font-semibold">Disagreement triage</h2>
          <p className="mt-1 text-xs text-muted-foreground">Pending subjects with persisted community classifications, ordered by stored uncertainty.</p>
        </div>
        <Badge variant="outline" className="font-mono text-[10px]">{cases.length} backend records</Badge>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.5fr)]">
        <aside className="flex min-h-0 flex-col border-b border-border xl:border-b-0 xl:border-r">
          <div className="grid grid-cols-1 gap-2 border-b border-border p-3 sm:grid-cols-[1fr_170px]">
            <Input aria-label="Search triage records" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search subject, class, or ID" />
            <Select aria-label="Filter by community class" value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
              <option value="all">All community classes</option>
              {[...new Set(cases.map((item) => item.consensus_class).filter((value): value is string => Boolean(value)))].sort().map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {filteredCases.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">No pending cases match this filter.</p>
            ) : filteredCases.map((item) => (
              <button key={item.subject_id} type="button" onClick={() => setSelectedId(item.subject_id)} className={`mb-1 w-full rounded-lg border p-3 text-left transition-colors ${selected?.subject_id === item.subject_id ? 'border-primary/40 bg-primary/10' : 'border-transparent hover:bg-secondary/70'}`}>
                <span className="flex items-start justify-between gap-2"><span className="text-sm font-medium">{item.title}</span><span className="font-mono text-[10px] text-muted-foreground">H {item.shannon_entropy.toFixed(2)}</span></span>
                <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">{item.subject_id}</span>
                <span className="mt-2 flex flex-wrap gap-1"><Badge variant="outline" className="text-[9px]">AI · {item.ai_predicted_class}</Badge><Badge variant="sky" className="text-[9px]">Community · {item.consensus_class ?? 'no consensus'}</Badge></span>
              </button>
            ))}
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto p-4 sm:p-6">
          {selected ? (
            <article className="mx-auto max-w-4xl space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="font-mono text-[10px] text-muted-foreground">{selected.subject_id}</p><h3 className="mt-1 text-xl font-semibold">{selected.title}</h3><p className="mt-1 text-xs text-muted-foreground">{selected.category} · {selected.data_release}</p></div>
                <Link className="rounded-md border border-border px-3 py-2 text-xs hover:bg-secondary" to={`/explore?tab=navigator&ra=${selected.ra}&dec=${selected.dec}`}>Open coordinates in Navigator ↗</Link>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <section className="rounded-xl border border-border bg-card p-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Model output</p><p className="mt-2 text-sm font-medium">{selected.ai_predicted_class}</p><p className="mt-1 text-xs text-muted-foreground">Anomaly score {Number(selected.ai_anomaly_score).toFixed(3)}</p><p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{JSON.stringify(selected.ai_probabilities)}</p></section>
                <section className="rounded-xl border border-border bg-card p-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Community classifications</p><p className="mt-2 text-sm font-medium">{selected.consensus_class ?? 'No consensus yet'}</p><p className="mt-1 text-xs text-muted-foreground">Consensus score {Number(selected.consensus_score).toFixed(3)} · {selected.vote_count} stored votes</p><p className="mt-1 text-xs text-muted-foreground">{selected.classification_count} classifications recorded</p></section>
              </div>
              <section className="rounded-xl border border-border bg-card p-4"><h4 className="text-xs font-semibold">Stored model explanation</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{selected.ai_explanation || 'No explanation is stored for this record.'}</p></section>
              <section className="rounded-xl border border-dashed border-border p-4"><h4 className="text-xs font-semibold">Evidence inspection</h4><p className="mt-2 text-xs leading-relaxed text-muted-foreground">This queue response contains no FITS planes or image cutout. Open the subject coordinates in Navigator to load archive evidence; this screen will not draw a simulated preview.</p></section>
              <p className="border-t border-border pt-3 text-[10px] text-muted-foreground">Read-only: the current backend exposes no admin-gated verify, flag, or training-buffer action for this case.</p>
            </article>
          ) : <p className="p-6 text-sm text-muted-foreground">No pending triage cases were returned by the backend.</p>}
        </main>
      </div>
    </div>
  );
};

export default HardNegativeTriageLive;
