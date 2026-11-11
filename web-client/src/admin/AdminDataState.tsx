import React from 'react';

export const AdminDataState: React.FC<{
  title: string;
  detail?: string | null;
  loading?: boolean;
}> = ({ title, detail, loading = false }) => (
  <section className="flex h-full min-h-72 items-center justify-center overflow-y-auto p-6" aria-live="polite">
    <div className="max-w-lg rounded-xl border border-border bg-card p-6">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Mission Control · data status</p>
      <h2 className="mt-3 text-lg font-semibold">{loading ? 'Loading persisted data' : title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {detail ?? 'This workspace displays records returned by the Spectra backend. No generated or sample records are substituted.'}
      </p>
      {loading && <span className="sr-only" role="status">Loading</span>}
    </div>
  </section>
);
