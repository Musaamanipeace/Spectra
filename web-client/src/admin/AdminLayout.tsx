import React, { lazy } from 'react';
import { Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { Button, Badge } from '../components/ui';
import { cn } from '../lib/utils';

const TrainingDynamics = lazy(() => import('./TrainingDynamics'));
const ActivationInspector = lazy(() => import('./ActivationInspector'));
const DecisionBoundaries = lazy(() => import('./DecisionBoundaries'));
const HardNegativeTriage = lazy(() => import('./HardNegativeTriageLive'));
const DataProductExports = lazy(() => import('./DataProductExportsLive'));

/**
 * Spectra Administrative Mission Control Shell (/admin/*)
 * Specification Anchors: SPECIFICATION.md §6.4, §6.5
 * 
 * Enforces Zero-Auth Route Isolation:
 * - Direct URL access without login modal barrier
 * - Explicit [Read-Only Demo Mode] banner when mutations disabled
 * - Tabbed navigation across 5 Mission Control workstations:
 *   1. /admin/dynamics: Training Dynamics & Loss Studio
 *   2. /admin/internals: Parameter Updates & Activation Inspector
 *   3. /admin/boundaries: Decision Boundary Animator
 *   4. /admin/triage: Disagreement & Escalation Queue (Issue #28)
 *   5. /admin/exports: Calibration & Mission Data Product Hub (Issue #28)
 */
export const AdminLayout: React.FC = () => {
  const location = useLocation();
  const currentPath = location.pathname;

  // Determine active tab from URL path
  const getActiveTab = () => {
    if (currentPath.includes('/admin/internals')) return 'internals';
    if (currentPath.includes('/admin/boundaries')) return 'boundaries';
    if (currentPath.includes('/admin/triage')) return 'triage';
    if (currentPath.includes('/admin/exports')) return 'exports';
    return 'dynamics';
  };

  const activeTab = getActiveTab();

  const navItems = [
    { id: 'dynamics', label: 'Training dynamics', path: '/admin/dynamics' },
    { id: 'internals', label: 'Activations & parameters', path: '/admin/internals' },
    { id: 'boundaries', label: 'Decision boundaries', path: '/admin/boundaries' },
    { id: 'triage', label: 'Disagreement triage', path: '/admin/triage' },
    { id: 'exports', label: 'Data products', path: '/admin/exports' },
  ];

  return (
    <div className="flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-background font-sans text-foreground">
      {/* MISSION CONTROL TOP BAR (SPECIFICATION.md §6.4) */}
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3 shadow-sm sm:px-5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-primary" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Spectra</p>
              <h1 className="text-sm font-semibold tracking-wide text-foreground">Mission Control</h1>
            </div>
          </div>
          <Badge variant="amber" className="hidden shrink-0 font-mono text-[10px] sm:inline-flex">
            Read-only mode
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          <Link to="/explore?tab=navigator">
            <Button variant="outline" size="sm" className="gap-1.5 px-2 text-xs sm:px-3">
              <span>←</span>
              <span className="hidden sm:inline">Return to sky view</span>
              <span className="sm:hidden">Explore</span>
            </Button>
          </Link>
        </div>
      </header>

      <div className="border-b border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[10px] text-amber-100 md:hidden">
        <span className="font-semibold">Read-only by default.</span> Administrative changes require server-side authorization.
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      {/* WORKSPACE RAIL */}
      <nav aria-label="Mission Control workspaces" className="flex shrink-0 items-center border-b border-border bg-secondary/40 px-2 py-1 gap-1 overflow-x-auto md:w-64 md:flex-col md:items-stretch md:border-b-0 md:border-r md:px-3 md:py-4">
        <p className="hidden px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:block">Workspaces</p>
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <Link
              key={item.id}
              to={item.path}
              className={cn(
                'rounded-lg px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap md:w-full md:border-b-0 md:text-left',
                isActive
                  ? 'bg-primary/10 text-foreground ring-1 ring-inset ring-primary/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              )}
            >
              {item.label}
            </Link>
          );
        })}
        <div className="mt-3 hidden rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 md:block">
          <p className="text-xs font-medium text-amber-200">Read-only by default</p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">Administrative changes require server-side authorization.</p>
        </div>
      </nav>

      {/* WORKSPACE CONTENT ROUTER */}
      <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<Navigate to="/admin/dynamics" replace />} />
          <Route path="/dynamics" element={<TrainingDynamics />} />
          <Route path="/internals" element={<ActivationInspector />} />
          <Route path="/boundaries" element={<DecisionBoundaries />} />
          <Route path="/triage" element={<HardNegativeTriage />} />
          <Route path="/exports" element={<DataProductExports />} />
          <Route path="*" element={<Navigate to="/admin/dynamics" replace />} />
        </Routes>
      </main>
      </div>
    </div>
  );
};

export default AdminLayout;
