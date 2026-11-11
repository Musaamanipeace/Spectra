import React, { useEffect, useState } from 'react';
import { Button, Badge, Card, CardHeader, CardTitle, CardContent } from '../components/ui';
import { AdminDataState } from './AdminDataState';

type ProductId = 'candidates' | 'ices' | 'variability' | 'artifacts';
interface ProductSummary {
  title: string;
  description: string;
  count: number;
  verified_count: number;
  formats: string[];
}
interface ReliabilitySummary {
  observer_count: number;
  mean_reliability_weight: number | null;
  weights: number[];
  source: string;
}
interface CalibrationRecord {
  subject_id: string;
  title: string;
  category: string;
  expert_ground_truth: string;
  data_release: string;
  classifications: number;
  correct_classifications: number;
  accuracy: number | null;
}

const formatLabels: Record<string, string> = { csv: 'CSV', votable: 'VOTable', json: 'JSON', fits: 'FITS', hdf5: 'HDF5' };

export const DataProductExportsLive: React.FC = () => {
  const [view, setView] = useState<'exporters' | 'reliability' | 'calibration'>('exporters');
  const [products, setProducts] = useState<Record<ProductId, ProductSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadKey, setDownloadKey] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [reliability, setReliability] = useState<ReliabilitySummary | null>(null);
  const [calibration, setCalibration] = useState<CalibrationRecord[] | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 8000);
    fetch('/api/admin/export/summary', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Product summary request failed (${response.status})`);
        return response.json();
      })
      .then((payload) => {
        setProducts(payload?.products ?? null);
        setError(null);
      })
      .catch((cause) => {
        if (controller.signal.aborted && !timedOut) return;
        setProducts(null);
        setError(timedOut ? 'Product summary request timed out' : cause instanceof Error ? cause.message : 'Product summary is unavailable');
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (!controller.signal.aborted || timedOut) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (view === 'exporters') return;
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 8000);
    const endpoint = view === 'reliability' ? '/api/admin/reliability' : '/api/admin/calibration?limit=200';
    setAnalysisLoading(true);
    fetch(endpoint, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        return response.json();
      })
      .then((payload) => {
        if (view === 'reliability') setReliability(payload as ReliabilitySummary);
        else setCalibration(Array.isArray(payload?.records) ? payload.records as CalibrationRecord[] : []);
        setAnalysisError(null);
      })
      .catch((cause) => {
        if (controller.signal.aborted && !timedOut) return;
        setAnalysisError(timedOut ? 'Data request timed out' : cause instanceof Error ? cause.message : 'The requested records are unavailable');
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (!controller.signal.aborted || timedOut) setAnalysisLoading(false);
      });
    return () => controller.abort();
  }, [view]);

  const download = async (product: ProductId, format: string) => {
    const key = `${product}:${format}`;
    setDownloadKey(key);
    setDownloadError(null);
    try {
      const response = await fetch(`/api/admin/export/${encodeURIComponent(format)}?product=${encodeURIComponent(product)}`);
      if (!response.ok) throw new Error(`Export request failed (${response.status})`);
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition');
      const filename = disposition?.match(/filename="?([^";]+)"?/)?.[1] ?? `spectra-community-${product}.${format}`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : 'Export failed');
    } finally {
      setDownloadKey(null);
    }
  };

  if (loading || error || !products) {
    return <AdminDataState title={error ? 'Product catalog unavailable' : 'Loading product catalog'} detail={error ?? undefined} loading={loading} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Community Product</p><h2 className="mt-1 text-lg font-semibold">Data products & calibration</h2><p className="mt-1 text-xs text-muted-foreground">Counts and exports come from persisted classified subjects.</p></div>
        <Badge variant="outline" className="font-mono text-[10px]">No NASA endorsement claimed</Badge>
      </header>
      <nav aria-label="Data product sections" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3 py-2">
        {([['exporters', 'Product exports'], ['reliability', 'Volunteer reliability'], ['calibration', 'Calibration pool']] as const).map(([id, label]) => (
          <button key={id} type="button" aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)} className={`shrink-0 rounded-md px-3 py-2 text-xs ${view === id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>{label}</button>
        ))}
      </nav>
      <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {view === 'exporters' ? (
          <div className="mx-auto max-w-6xl space-y-4">
            <p className="rounded-lg border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground">Exports are generated from current database rows and carry the <span className="font-mono text-primary">Community Product</span> attribution. Unsupported tensor products are not advertised as available.</p>
            {downloadError && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">{downloadError}</p>}
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {(Object.entries(products) as [ProductId, ProductSummary][]).map(([id, product]) => (
                <Card key={id} className="flex flex-col border-border">
                  <CardHeader className="border-b border-border bg-secondary/30 p-4"><div className="flex items-center justify-between gap-2"><CardTitle className="text-sm">{product.title}</CardTitle><Badge variant="outline" className="shrink-0 font-mono text-[10px]">{product.count} records</Badge></div><p className="text-xs text-muted-foreground">{product.verified_count} verified</p></CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-4 p-4"><p className="text-xs leading-relaxed text-muted-foreground">{product.description}</p><div className="mt-auto flex flex-wrap gap-2">{product.formats.map((format) => { const key = `${id}:${format}`; return <Button key={format} size="sm" variant="outline" disabled={product.count === 0 || downloadKey !== null} onClick={() => void download(id, format)}>{downloadKey === key ? 'Preparing…' : `Download ${formatLabels[format] ?? format.toUpperCase()}`}</Button>; })}</div></CardContent>
                </Card>
              ))}
            </div>
          </div>
        ) : analysisLoading ? <AdminDataState title="Loading persisted records" loading /> : analysisError ? <AdminDataState title="Records unavailable" detail={analysisError} /> : view === 'reliability' && reliability ? (
          <div className="mx-auto max-w-5xl space-y-4">
            <section className="grid gap-3 sm:grid-cols-2"><Card className="border-border p-4"><p className="text-xs text-muted-foreground">Observers with stored reliability</p><p className="mt-2 font-mono text-2xl">{reliability.observer_count}</p></Card><Card className="border-border p-4"><p className="text-xs text-muted-foreground">Mean reliability weight</p><p className="mt-2 font-mono text-2xl">{reliability.mean_reliability_weight === null ? '—' : reliability.mean_reliability_weight.toFixed(3)}</p></Card></section>
            <Card className="border-border p-4"><h3 className="text-sm font-semibold">Stored observer reliability distribution</h3><p className="mt-1 text-xs text-muted-foreground">{reliability.source}. No identities or secret observer fields are exposed.</p>{reliability.weights.length ? <div className="mt-5 flex h-52 items-end gap-2 border-b border-border pb-2">{Array.from({ length: 9 }, (_, index) => { const low = index / 10; const high = (index + 1) / 10; const count = reliability.weights.filter((weight) => weight >= low && (index === 8 ? weight <= high : weight < high)).length; const max = Math.max(...Array.from({ length: 9 }, (_, bin) => reliability.weights.filter((weight) => weight >= bin / 10 && (bin === 8 ? weight <= (bin + 1) / 10 : weight < (bin + 1) / 10)).length), 1); return <div key={index} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><span className="font-mono text-[10px] text-muted-foreground">{count}</span><div className="w-full rounded-t bg-primary/70" style={{ height: `${(count / max) * 70}%` }} /><span className="font-mono text-[9px] text-muted-foreground">{low.toFixed(1)}–{high.toFixed(1)}</span></div>; })}</div> : <p className="mt-4 text-sm text-muted-foreground">No observer reliability records are stored.</p>}</Card>
          </div>
        ) : view === 'calibration' && calibration ? (
          <div className="mx-auto max-w-6xl space-y-4"><p className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">Read-only calibration evidence from persisted subjects. Ground truth and classification totals are displayed only when present in the database.</p><div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-secondary/50 text-muted-foreground"><tr><th className="p-3">Subject</th><th className="p-3">Category</th><th className="p-3">Ground truth</th><th className="p-3">Classifications</th><th className="p-3">Correct</th><th className="p-3">Accuracy</th><th className="p-3">Release</th></tr></thead><tbody className="divide-y divide-border">{calibration.map((record) => <tr key={record.subject_id}><td className="p-3"><span className="block font-medium">{record.title}</span><span className="font-mono text-[10px] text-muted-foreground">{record.subject_id}</span></td><td className="p-3">{record.category}</td><td className="p-3">{record.expert_ground_truth}</td><td className="p-3 font-mono">{record.classifications}</td><td className="p-3 font-mono">{record.correct_classifications}</td><td className="p-3 font-mono">{record.accuracy === null ? '—' : `${(record.accuracy * 100).toFixed(1)}%`}</td><td className="p-3">{record.data_release}</td></tr>)}</tbody></table>{calibration.length === 0 && <p className="p-5 text-sm text-muted-foreground">No calibration subjects with stored expert labels were returned.</p>}</div></div>
        ) : <AdminDataState title="Records unavailable" detail="The selected Mission Control data source returned no usable response." />}
      </main>
    </div>
  );
};

export default DataProductExportsLive;
