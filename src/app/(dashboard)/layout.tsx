'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { BotRuntimeRunner } from '@/components/bots/BotRuntimeRunner';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // IMPORTANT: do NOT read localStorage during initial render.
  // Client Components are pre-rendered on the server too; reading auth state there will differ
  // from the browser and cause hydration mismatches (e.g. missing <a> tags).
  const [authedState, setAuthedState] = useState<boolean | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const nextParam = useMemo(() => encodeURIComponent(pathname || '/home'), [pathname]);

  useEffect(() => {
    // One-time API onboarding gate:
    // After login, if Delta credentials are not configured, force user to API Integration setup once.
    const run = async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        const json = await res.json().catch(() => null);
        const ok = !!json?.ok;
        setAuthedState(ok);
        if (!ok) {
          router.replace(`/login?next=${nextParam}`);
          return;
        }
      } catch {
        setAuthedState(false);
        router.replace(`/login?next=${nextParam}`);
        return;
      }

      // Allow the setup page itself
      if (pathname.startsWith('/api-integration')) return;

      try {
        const res = await fetch('/api/delta/credentials', { cache: 'no-store' });
        const json = await res.json();
        if (!json?.configured) {
          router.replace(`/api-integration?setup=1&next=${nextParam}`);
          return;
        }
        // If user has credentials but no active exchange cookie yet, set a sensible default.
        if (!document.cookie.includes('exchange=')) {
          const first = json?.active || (json?.profiles ? Object.keys(json.profiles)[0] : null);
          if (first) {
            await fetch('/api/system/active-exchange', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ exchange: first }),
            });
          }
        }
      } catch {
        // If the check fails, do not block rendering.
      }
    };
    run();
  }, [nextParam, pathname, router]);

  useEffect(() => {
    // Catch chunk load errors during dev rebuilds and auto-reload once.
    // Throttled auto-reload (can happen more than once if chunks keep changing),
    // but prevents infinite loops.
    const w = window as any;
    if (typeof w.__chunkReloadState !== 'object' || !w.__chunkReloadState) {
      w.__chunkReloadState = { lastAt: 0, count: 0 };
    }
    const state = w.__chunkReloadState as { lastAt: number; count: number };
    const isChunkMsg = (msg: string) =>
      msg.includes('ChunkLoadError') ||
      msg.includes('Loading chunk') ||
      msg.includes('_next/static/chunks') ||
      msg.includes('Failed to fetch dynamically imported module');

    const onError = (e: any) => {
      const msg = String(e?.message || e?.error?.message || '');
      if (!msg || !isChunkMsg(msg)) return;
      const now = Date.now();
      if (state.count >= 5) return;
      if (now - state.lastAt < 2500) return;
      state.lastAt = now;
      state.count += 1;
      window.location.reload();
    };

    const onRejection = (e: any) => {
      const msg = String(e?.reason?.message || e?.reason || '');
      if (!msg || !isChunkMsg(msg)) return;
      const now = Date.now();
      if (state.count >= 5) return;
      if (now - state.lastAt < 2500) return;
      state.lastAt = now;
      state.count += 1;
      window.location.reload();
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  const logout = () => {
    void fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    setAuthedState(false);
    router.replace('/login');
  };

  // Keep server HTML and first client render identical.
  // We render a small placeholder until auth state is known.
  if (authedState === null) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <header className="border-b border-slate-200 bg-white/70 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600" />
              <div className="leading-tight">
                <div className="text-sm font-semibold tracking-wide text-slate-900">9BOT</div>
                <div className="text-xs text-slate-500">Grid Trading Platform</div>
              </div>
            </div>
          </div>
        </header>
        <main className="min-h-screen overflow-x-hidden overflow-y-auto">
          <div className="mx-auto max-w-7xl px-6 py-16">
            <div className="flex items-center justify-center gap-3 text-slate-700">
              <LoadingSpinner className="h-6 w-6" />
              <div className="text-sm font-medium">Checking session…</div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Hard-block content when logged out (prevents cached UI showing on back navigation).
  if (authedState === false) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <header className="border-b border-slate-200 bg-white/70 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600" />
              <div className="leading-tight">
                <div className="text-sm font-semibold tracking-wide text-slate-900">9BOT</div>
                <div className="text-xs text-slate-500">Grid Trading Platform</div>
              </div>
            </div>
          </div>
        </header>
        <main className="min-h-screen overflow-x-hidden overflow-y-auto">
          <div className="mx-auto max-w-7xl px-6 py-16">
            <div className="flex items-center justify-center gap-3 text-slate-700">
              <LoadingSpinner className="h-6 w-6" />
              <div className="text-sm font-medium">Redirecting to login…</div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const NavLink = ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => {
    // In dev, client routing can break due to chunk/HMR issues; full navigations are more reliable.
    if (process.env.NODE_ENV === 'development') {
      return (
        <a href={href} className={className}>
          {children}
        </a>
      );
    }
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <BotRuntimeRunner />
      <header className="border-b border-slate-200 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <NavLink href="/home" className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600" />
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-wide text-slate-900">9BOT</div>
              <div className="text-xs text-slate-500">Grid Trading Platform</div>
            </div>
          </NavLink>

          <nav className="hidden items-center gap-6 text-sm text-slate-700 md:flex">
            <NavLink className="hover:text-slate-900" href="/home">Home</NavLink>
            <NavLink className="hover:text-slate-900" href="/portfolio">Portfolio</NavLink>
            <NavLink className="hover:text-slate-900" href="/bot/control">Control Panel</NavLink>
            <NavLink className="hover:text-slate-900" href="/orders">Orders</NavLink>
            <NavLink className="hover:text-slate-900" href="/fills">Fills</NavLink>
            <NavLink className="hover:text-slate-900" href="/bot/create">Create Bot</NavLink>
            <NavLink className="hover:text-slate-900" href="/api-integration">API Integration</NavLink>
          </nav>

          <div className="flex items-center gap-3">
            <div className="relative md:hidden">
              <button
                onClick={() => setMobileOpen((v) => !v)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
              >
                Menu
              </button>
              {mobileOpen ? (
                <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                  {[
                    { href: '/home', label: 'Home' },
                    { href: '/portfolio', label: 'Portfolio' },
                    { href: '/bot/control', label: 'Control Panel' },
                    { href: '/orders', label: 'Orders' },
                    { href: '/fills', label: 'Fills' },
                    { href: '/bot/create', label: 'Create Bot' },
                    { href: '/api-integration', label: 'API Integration' },
                  ].map((item) => (
                    <NavLink
                      key={item.href}
                      href={item.href}
                      className="block px-4 py-3 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <span onClick={() => setMobileOpen(false)}>{item.label}</span>
                    </NavLink>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              onClick={logout}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="min-h-screen overflow-x-hidden overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}

