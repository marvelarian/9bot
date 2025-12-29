'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const didReloadRef = useRef(false);

  useEffect(() => {
    const msg = String(error?.message || '');
    const isChunk =
      msg.includes('ChunkLoadError') ||
      msg.includes('Loading chunk') ||
      msg.includes('_next/static/chunks') ||
      msg.includes('Failed to fetch dynamically imported module');

    // In dev, Next rebuilds chunks frequently; the browser can try to load a stale chunk.
    // Instead of forcing users to hard refresh, auto-reload (throttled to avoid loops).
    if (isChunk && !didReloadRef.current) {
      const w = window as any;
      if (typeof w.__chunkReloadState !== 'object' || !w.__chunkReloadState) {
        w.__chunkReloadState = { lastAt: 0, count: 0 };
      }
      const state = w.__chunkReloadState as { lastAt: number; count: number };
      const now = Date.now();
      if (state.count < 5 && now - state.lastAt > 2500) {
        didReloadRef.current = true;
        state.lastAt = now;
        state.count += 1;
        window.location.reload();
      }
    }
  }, [error]);

  return (
    <div className="min-h-[60vh] w-full">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="text-sm font-semibold text-slate-900">Dashboard error</div>
          <div className="mt-2 text-sm text-slate-600">
            {String(error?.message || 'Something went wrong while loading this page.')}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={() => reset()}>Try again</Button>
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          </div>
          <div className="mt-3 text-[11px] text-slate-500">
            Tip: if you are developing and changed code recently, this can be a stale chunk. Reload usually fixes it.
          </div>
        </div>
      </div>
    </div>
  );
}



