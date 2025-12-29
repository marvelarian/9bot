'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function SignupPage() {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = useMemo(() => params.get('next') || '/home', [params]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // no-op (server-side auth)
  }, []);

  // If already logged in, bounce to app.
  useEffect(() => {
    try {
      fetch('/api/auth/me', { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => {
          if (j?.ok) router.replace(nextPath);
        })
        .catch(() => null);
    } catch {
      // ignore
    }
  }, [nextPath, router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (password !== confirm) throw new Error('Passwords do not match');
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || 'Sign up failed');
      router.push(nextPath);
    } catch (err: any) {
      setError(err?.message || 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-white">
      <div className="mx-auto max-w-7xl px-6">
        <div className="py-6">
          <nav className="flex items-center justify-between">
            <a href="/" className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600" />
              <div className="leading-tight">
                <div className="text-sm font-semibold tracking-wide">9BOT</div>
                <div className="text-xs text-slate-300">Grid Trading Platform</div>
              </div>
            </a>
            <div className="flex items-center gap-3">
              <a href="/pricing" className="text-sm text-slate-200 hover:text-white">Pricing</a>
              <a href="/login" className="text-sm text-slate-200 hover:text-white">Log in</a>
            </div>
          </nav>
        </div>

        <section className="grid items-center gap-10 py-14 md:grid-cols-2 md:py-20">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200">
              <span className="h-2 w-2 rounded-full bg-cyan-400" />
              Create account (demo)
            </div>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight md:text-5xl">Sign up</h1>
            <p className="mt-4 max-w-xl text-slate-300">
              Create a local demo account for this browser. This is only for UI flow testing — replace with real authentication later.
            </p>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 rounded-3xl bg-gradient-to-r from-cyan-500/20 to-blue-500/20 blur-2xl" />
            <div className="relative rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="text-lg font-semibold">Get started</div>
              <div className="mt-1 text-sm text-slate-300">Create your login for this device.</div>

              <form onSubmit={onSubmit} className="mt-6 space-y-4">
                <div>
                  <label className="text-sm text-slate-200">Email</label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
                    placeholder="you@example.com"
                    required
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-200">Password</label>
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type="password"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
                    placeholder="Min 6 characters"
                    minLength={6}
                    required
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-200">Confirm password</label>
                  <input
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    type="password"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
                    placeholder="Repeat password"
                    minLength={6}
                    required
                  />
                </div>

                {error && (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-60"
                >
                  {loading ? 'Creating…' : 'Create account'}
                </button>
              </form>

              <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
                <span>By continuing you agree to the risk disclaimer.</span>
                <a className="text-cyan-300 hover:text-cyan-200" href={`/login?next=${encodeURIComponent(nextPath)}`}>Log in</a>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}


