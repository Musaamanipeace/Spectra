import { useEffect } from 'react';
import { useTelemetryStore } from '../store/useTelemetryStore';

interface KeyboardTelemetryOptions {
  onToggleCommandPalette?: () => void;
}

/**
 * Global Keyboard Shortcuts for Scientific Telemetry Control
 * Specification Anchor: SPECIFICATION.md §6.1.4
 *
 * Shortcuts:
 * - Cmd+K / Ctrl+K: Toggle universal command palette
 * - Spacebar: Play/Pause temporal pass playback
 * - Left/Right Arrow: Step backward/forward by discrete survey pass
 * - 1: Blink mode
 * - 2: Signed Difference mode
 * - 3: Co-Add Stack mode
 * - R: Reset pan/zoom and view parameters
 * - I: Invert grayscale colormap
 */
export function useKeyboardTelemetry(options: KeyboardTelemetryOptions = {}) {
  const { onToggleCommandPalette } = options;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      // Cmd+K / Ctrl+K works even inside or outside inputs to toggle search
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onToggleCommandPalette?.();
        return;
      }

      // Alt+S: Jump to Live Stitched Sky View (Phase A, Issue A.1)
      if (event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        const url = new URL(window.location.href);
        url.searchParams.set('tab', 'navigator');
        url.searchParams.set('fov', '180');
        url.searchParams.set('mode', 'stitched_hips');
        url.searchParams.set('preset', 'all_sky');
        url.searchParams.set('ra', '266.41682');
        url.searchParams.set('dec', '-29.00782');
        window.history.pushState({}, '', url.toString());
        window.dispatchEvent(new PopStateEvent('popstate'));
        const store = useTelemetryStore.getState();
        store.setCoordinates(266.41682, -29.00782, 'Galactic Center (All-Sky HiPS)', '[SPHEREx Stitched HiPS]');
        return;
      }

      // Do not capture other navigation shortcuts when the user is typing into text fields
      if (isInput) return;

      const store = useTelemetryStore.getState();

      switch (event.code) {
        case 'Space':
          event.preventDefault();
          store.togglePlayback();
          break;

        case 'ArrowLeft':
          event.preventDefault();
          store.stepEpoch(-1);
          break;

        case 'ArrowRight':
          event.preventDefault();
          store.stepEpoch(1);
          break;

        case 'Digit1':
          store.setRenderMode('blink');
          break;

        case 'Digit2':
          store.setRenderMode('difference');
          break;

        case 'Digit3':
          store.setRenderMode('coadd');
          break;

        case 'KeyR':
          store.resetView();
          break;

        case 'KeyI':
          store.toggleInvertGrayscale();
          break;

        default:
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onToggleCommandPalette]);
}
