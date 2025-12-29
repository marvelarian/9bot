export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-white">
      <div className="mx-auto max-w-7xl px-6">
        <div className="py-6">
          <nav className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600" />
              <div className="leading-tight">
                <div className="text-sm font-semibold tracking-wide">9BOT</div>
                <div className="text-xs text-slate-300">Grid Trading Platform</div>
              </div>
            </div>
            <div className="hidden items-center gap-6 text-sm text-slate-200 md:flex">
              <a className="hover:text-white" href="#features">Features</a>
              <a className="hover:text-white" href="#how">How it works</a>
              <a className="hover:text-white" href="/pricing">Pricing</a>
              <a className="hover:text-white" href="/home">Dashboard</a>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="/login"
                className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10"
              >
                Log in
              </a>
              <a
                href="/home"
                className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
              >
                Open dashboard
              </a>
            </div>
          </nav>
        </div>

        <section className="py-14 md:py-20">
          <div className="grid items-center gap-10 md:grid-cols-2">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Automate grid trading with risk controls
              </div>
              <h1 className="mt-5 text-4xl font-semibold tracking-tight md:text-5xl">
                The most configurable <span className="bg-gradient-to-r from-cyan-300 to-blue-500 bg-clip-text text-transparent">grid trading</span> bot for Delta Exchange
              </h1>
              <p className="mt-5 max-w-xl text-base text-slate-300 md:text-lg">
                Build and run grid strategies with long/short/neutral modes, de-oscillation level logic, max positions, leverage, and circuit breakers—inside a clean dashboard.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <a
                  href="/bot/create"
                  className="rounded-lg bg-white px-5 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100"
                >
                  Create a bot
                </a>
                <a
                  href="/pricing"
                  className="rounded-lg border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10"
                >
                  See pricing
                </a>
              </div>
              <div className="mt-8 grid grid-cols-3 gap-4 text-xs text-slate-300">
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="text-white font-semibold">Modes</div>
                  <div className="mt-1">Long / Short / Neutral</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="text-white font-semibold">Controls</div>
                  <div className="mt-1">Max positions & loss limits</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="text-white font-semibold">Visibility</div>
                  <div className="mt-1">Grid status & alerts</div>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="absolute -inset-4 rounded-3xl bg-gradient-to-r from-cyan-500/20 to-blue-500/20 blur-2xl" />
              <div className="relative rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Bot Dashboard</div>
                  <div className="text-xs text-slate-300">Live preview</div>
                </div>
                <div className="mt-4 grid gap-3">
                  <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold">BTCUSD · Long</div>
                        <div className="mt-1 text-xs text-slate-300">Range 40,000 → 50,000 · 10 grids</div>
                      </div>
                      <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300">
                        Running
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
                      <div className="rounded-xl bg-white/5 p-2">
                        <div className="text-slate-300">PnL</div>
                        <div className="font-semibold text-emerald-300">+$245.67</div>
                      </div>
                      <div className="rounded-xl bg-white/5 p-2">
                        <div className="text-slate-300">Trades</div>
                        <div className="font-semibold text-white">15</div>
                      </div>
                      <div className="rounded-xl bg-white/5 p-2">
                        <div className="text-slate-300">Positions</div>
                        <div className="font-semibold text-white">3</div>
                      </div>
                      <div className="rounded-xl bg-white/5 p-2">
                        <div className="text-slate-300">Risk</div>
                        <div className="font-semibold text-white">OK</div>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
                    <div className="text-xs font-semibold text-slate-200">Grid status</div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-slate-300">Active levels</span>
                      <span className="font-semibold text-white">7/10</span>
                    </div>
                    <div className="mt-3 h-2 w-full rounded-full bg-white/10">
                      <div className="h-2 w-[70%] rounded-full bg-gradient-to-r from-cyan-400 to-blue-500" />
                    </div>
                  </div>
                </div>
                <div className="mt-4 text-xs text-slate-400">
                  Tip: connect your Delta Exchange API via server-side proxy for live trading.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="py-12 md:py-16">
          <div className="flex items-end justify-between gap-6">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Automate with confidence</h2>
              <p className="mt-2 max-w-2xl text-slate-300">
                Inspired by best-in-class bot platforms’ UX patterns, focused on grid trading controls and observability.
              </p>
            </div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              {
                title: 'Smart level de-oscillation',
                body: 'When price crosses a level, that level becomes inactive; when price crosses another level, the previous reactivates—prevents multiple entries during chop.',
              },
              {
                title: 'Risk controls built-in',
                body: 'Max positions, leverage, consecutive loss limit, and circuit breaker guardrails to keep strategies contained.',
              },
              {
                title: 'Clear dashboard',
                body: 'Bot list, performance metrics, grid status, and alert stream so you always know what the bot is doing.',
              },
            ].map((c) => (
              <div key={c.title} className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <div className="text-base font-semibold">{c.title}</div>
                <div className="mt-2 text-sm text-slate-300">{c.body}</div>
              </div>
            ))}
          </div>
        </section>

        <section id="how" className="py-12 md:py-16">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                step: '01',
                title: 'Choose symbol & range',
                body: 'Set symbol, lower/upper range, number of grids and spacing is auto-calculated.',
              },
              {
                step: '02',
                title: 'Select mode & size',
                body: 'Long/short/neutral plus quantity and leverage. Add max positions and loss constraints.',
              },
              {
                step: '03',
                title: 'Run & monitor',
                body: 'Start the bot, watch grid status, positions, and alerts. Adjust configuration when needed.',
              },
            ].map((s) => (
              <div key={s.step} className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <div className="text-xs font-semibold text-slate-400">{s.step}</div>
                <div className="mt-2 text-base font-semibold">{s.title}</div>
                <div className="mt-2 text-sm text-slate-300">{s.body}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="py-10">
          <div className="rounded-3xl border border-white/10 bg-gradient-to-r from-cyan-500/15 to-blue-500/15 p-8 md:p-10">
            <div className="grid items-center gap-6 md:grid-cols-2">
              <div>
                <div className="text-2xl font-semibold">Ready to build your first grid bot?</div>
                <div className="mt-2 text-slate-300">
                  Start by configuring a bot, then connect your exchange via server-side API proxy.
                </div>
              </div>
              <div className="flex flex-wrap gap-3 md:justify-end">
                <a href="/bot/create" className="rounded-lg bg-white px-5 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100">
                  Create a bot
                </a>
                <a href="/login" className="rounded-lg border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10">
                  Log in
                </a>
              </div>
            </div>
          </div>
        </section>

        <footer className="border-t border-white/10 py-10 text-sm text-slate-400">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>© {new Date().getFullYear()} 9BOT · Grid Trading Platform</div>
            <div className="flex gap-4">
              <a className="hover:text-white" href="/pricing">Pricing</a>
              <a className="hover:text-white" href="/login">Login</a>
              <a className="hover:text-white" href="/home">Dashboard</a>
            </div>
          </div>
          <div className="mt-4 text-xs text-slate-500">
            Disclaimer: Crypto trading is risky. Past performance is not indicative of future results.
          </div>
        </footer>
      </div>
    </main>
  )
}

