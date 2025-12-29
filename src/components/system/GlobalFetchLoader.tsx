'use client';

import { useEffect, useState } from 'react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

/**
 * Shows a small overlay spinner whenever any client-side fetch() is in-flight.
 * This covers API calls during page loads and user interactions.
 */
export function GlobalFetchLoader() {
  const [pending, setPending] = useState(0);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const w = window as any;
    if (w.__fetchPatched) return;
    w.__fetchPatched = true;

    const origFetch = window.fetch.bind(window);

    window.fetch = async (...args: Parameters<typeof fetch>) => {
      // Only track our API requests. Tracking all fetches (including Next internals)
      // can lead to a loader that appears to "never stop".
      let url = '';
      try {
        const input: any = args[0];
        if (typeof input === 'string') url = input;
        else if (input && typeof input === 'object' && typeof input.url === 'string') url = input.url;
      } catch {}

      const track = url.startsWith('/api/') || url.includes('/api/');
      if (!track) return await origFetch(...args);

      // Do NOT show global loader for noisy background polls/streams.
      // These run continuously (bot runtime snapshots, activity, equity history, price streams).
      const ignore =
        url.includes('/api/bots') ||
        url.includes('/api/activity') ||
        url.includes('/api/equity/history') ||
        url.includes('/api/prices/stream');
      if (ignore) return await origFetch(...args);

      setPending((n) => n + 1);
      let done = false;
      const dec = () => {
        if (done) return;
        done = true;
        setPending((n) => Math.max(0, n - 1));
      };
      const safety = window.setTimeout(dec, 20_000);
      try {
        return await origFetch(...args);
      } finally {
        window.clearTimeout(safety);
        dec();
      }
    };

    return () => {
      // do not unpatch; preserve stability across HMR / re-mounts
    };
  }, []);

  useEffect(() => {
    if (pending <= 0) {
      setShow(false);
      return;
    }
    const t = window.setTimeout(() => setShow(true), 250);
    return () => window.clearTimeout(t);
  }, [pending]);

  if (!show || pending <= 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[100]">
      <div className="absolute right-4 top-4 rounded-xl border border-slate-200 bg-white/90 px-3 py-2 shadow-sm backdrop-blur">
        <div className="flex items-center gap-2 text-sm text-slate-700">
          <LoadingSpinner />
          <span>Loading…</span>
        </div>
      </div>
    </div>
  );
}







