export default function PricingPage() {
  const tiers = [
    {
      name: 'Free',
      price: '$0',
      subtitle: 'Try the dashboard and configure bots.',
      cta: { label: 'Get started', href: '/home' },
      features: [
        '1 bot (demo)',
        'Grid status view',
        'Basic alerts',
        'Local-only configuration',
      ],
    },
    {
      name: 'Pro',
      price: '$29',
      subtitle: 'For active grid traders.',
      highlight: true,
      cta: { label: 'Start Pro', href: '/login' },
      features: [
        'Up to 5 bots',
        'Risk controls (max positions, loss limits)',
        'Strategy builder (rules)',
        'Exportable reports',
      ],
    },
    {
      name: 'Elite',
      price: '$99',
      subtitle: 'Teams and power users.',
      cta: { label: 'Contact sales', href: '/login' },
      features: [
        'Unlimited bots',
        'Multi-exchange framework (future)',
        'Advanced analytics',
        'Priority support',
      ],
    },
  ];

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

        <section className="py-14 md:py-18">
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Pricing</h1>
          <p className="mt-4 max-w-2xl text-slate-300">
            Pick a plan that matches how many bots you want to run and how deep you want risk + analytics tooling.
          </p>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {tiers.map((t) => (
              <div
                key={t.name}
                className={[
                  'rounded-2xl border bg-white/5 p-6',
                  t.highlight ? 'border-cyan-400/30 shadow-[0_0_0_1px_rgba(34,211,238,0.15)]' : 'border-white/10',
                ].join(' ')}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-lg font-semibold">{t.name}</div>
                  {t.highlight && (
                    <span className="rounded-full bg-cyan-500/15 px-3 py-1 text-xs font-medium text-cyan-200">
                      Popular
                    </span>
                  )}
                </div>
                <div className="mt-3 flex items-end gap-2">
                  <div className="text-4xl font-semibold">{t.price}</div>
                  <div className="pb-1 text-sm text-slate-300">/mo</div>
                </div>
                <div className="mt-2 text-sm text-slate-300">{t.subtitle}</div>

                <a
                  href={t.cta.href}
                  className={[
                    'mt-6 inline-flex w-full items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold',
                    t.highlight ? 'bg-white text-slate-900 hover:bg-slate-100' : 'border border-white/15 bg-white/5 text-white hover:bg-white/10',
                  ].join(' ')}
                >
                  {t.cta.label}
                </a>

                <ul className="mt-6 space-y-2 text-sm text-slate-300">
                  {t.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-cyan-300" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-slate-300">
            <div className="font-semibold text-white">Note</div>
            <div className="mt-2">
              Live trading integration should be done server-side to protect API secrets. The UI here is built to be extended with an API proxy.
            </div>
          </div>
        </section>

        <footer className="border-t border-white/10 py-10 text-sm text-slate-400">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>© {new Date().getFullYear()} 9BOT</div>
            <div className="flex gap-4">
              <a className="hover:text-white" href="/">Home</a>
              <a className="hover:text-white" href="/login">Login</a>
              <a className="hover:text-white" href="/home">Dashboard</a>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}


