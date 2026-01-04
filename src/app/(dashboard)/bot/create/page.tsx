'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { GridBotConfig } from '@/lib/types';
import { createBot, refreshBots } from '@/lib/bot-store';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LineChart, Settings2 } from 'lucide-react';
import { formatPrice } from '@/lib/format';

interface FormData {
  exchange: 'delta_india' | 'delta_global';
  execution: 'paper' | 'live';
  symbol: string;
  lowerRange: number;
  upperRange: number;
  gridInputMode: 'grids' | 'pct';
  gridPct: number;
  numberOfGrids: number;
  mode: 'long' | 'short' | 'neutral';
  investment: number;
  quantity: number;
  leverage: number;
  maxPositions: number;
  maxConsecutiveLoss: number;
  circuitBreaker: number;
}

declare global {
  interface Window {
    TradingView?: any;
  }
}

function toTradingViewSymbol(raw: string) {
  const s = (raw || '').trim().toUpperCase();
  if (!s) return 'BINANCE:BTCUSDT';
  // If user enters full TV symbol (e.g. BINANCE:BTCUSDT), use it as-is.
  if (s.includes(':')) return s;

  // Best-effort mapping for common USD pairs into a chart that actually exists.
  // TradingView usually has USDT pairs on major exchanges.
  const m = s.match(/^([A-Z0-9]{2,10})(USD|INR|USDT)$/);
  if (m) {
    const base = m[1];
    const quote = m[2];
    if (quote === 'USD') return `BINANCE:${base}USDT`;
    return `BINANCE:${base}${quote}`;
  }
  return `BINANCE:${s}`;
}

function TradingViewChart({ symbol }: { symbol: string }) {
  const containerId = useMemo(() => `tv_${Math.random().toString(36).slice(2, 10)}`, []);
  const lastSymbolRef = useRef<string>('');

  useEffect(() => {
    const tvSymbol = toTradingViewSymbol(symbol);
    if (lastSymbolRef.current === tvSymbol) return;
    lastSymbolRef.current = tvSymbol;

    let cancelled = false;

    const mount = async () => {
      // Ensure container exists
      const el = document.getElementById(containerId);
      if (!el) return;
      el.innerHTML = '';

      const ensureScript = () =>
        new Promise<void>((resolve, reject) => {
          if (window.TradingView) return resolve();
          const existing = document.querySelector<HTMLScriptElement>('script[data-tv="true"]');
          if (existing) {
            existing.addEventListener('load', () => resolve());
            existing.addEventListener('error', () => reject(new Error('TradingView script failed')));
            return;
          }
          const script = document.createElement('script');
          script.src = 'https://s3.tradingview.com/tv.js';
          script.async = true;
          script.dataset.tv = 'true';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('TradingView script failed'));
          document.head.appendChild(script);
        });

      try {
        await ensureScript();
        if (cancelled) return;
        if (!window.TradingView) return;

        // eslint-disable-next-line new-cap
        new window.TradingView.widget({
          autosize: true,
          symbol: tvSymbol,
          interval: '15',
          timezone: 'Etc/UTC',
          theme: 'light',
          style: '1',
          locale: 'en',
          toolbar_bg: '#f8fafc',
          enable_publishing: false,
          hide_side_toolbar: false,
          allow_symbol_change: true,
          container_id: containerId,
        });
      } catch {
        // Fallback: render a simple message
        const node = document.getElementById(containerId);
        if (node) {
          node.innerHTML =
            '<div style="padding:16px;color:#64748b;font-size:14px;">Chart unavailable. Try a TradingView symbol like <b>BINANCE:BTCUSDT</b>.</div>';
        }
      }
    };

    void mount();
    return () => {
      cancelled = true;
      const node = document.getElementById(containerId);
      if (node) node.innerHTML = '';
    };
  }, [containerId, symbol]);

  return <div id={containerId} className="h-[560px] w-full" />;
}

export default function CreateBotPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refPrice, setRefPrice] = useState<number | null>(null);

  const [formData, setFormData] = useState<FormData>({
    exchange: 'delta_india',
    execution: 'paper',
    symbol: 'BTCUSD',
    lowerRange: 40000,
    upperRange: 50000,
    gridInputMode: 'grids',
    gridPct: 0.25,
    numberOfGrids: 10,
    mode: 'long',
    investment: 300,
    // Qty is LOTS (not contracts). 1 lot = exchange-defined contract size.
    quantity: 1,
    leverage: 1,
    maxPositions: 5,
    maxConsecutiveLoss: 3,
    // Circuit breaker is % drawdown from started equity. Example: 5 means stop at -5%.
    circuitBreaker: 10,
  });

  useEffect(() => {
    // Default exchange is controlled server-side via cookie; keep UI default as delta_india for now.
  }, []);

  useEffect(() => {
    // Fetch reference price for creation-time spacing% calculation (Option B: required to create).
    const sym = (formData.symbol || '').trim().toUpperCase();
    if (!sym) {
      setRefPrice(null);
      return;
    }
    let alive = true;
    const run = async () => {
      try {
        const ex = formData.exchange;
        const res = await fetch(
          `/api/delta/ticker?symbol=${encodeURIComponent(sym)}&exchange=${encodeURIComponent(ex)}`,
          { cache: 'no-store' }
        );
        const json = await res.json().catch(() => null);
        const t = json?.result ?? {};
        const p = Number(t.mark_price ?? t.markPrice ?? t.last_price ?? t.lastPrice ?? t.close);
        if (!alive) return;
        setRefPrice(Number.isFinite(p) && p > 0 ? p : null);
      } catch {
        if (!alive) return;
        setRefPrice(null);
      }
    };
    void run();
    const t = setInterval(run, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [formData.symbol, formData.exchange]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Option B: require reference price at creation time.
      if (refPrice === null || !Number.isFinite(refPrice) || refPrice <= 0) {
        alert('Live price is unavailable right now. Please wait for the ticker price to load, then try again.');
        return;
      }

      // Validate ranges
      if (formData.lowerRange >= formData.upperRange) {
        alert('Lower range must be less than upper range');
        return;
      }

      const rangeAbs = formData.upperRange - formData.lowerRange;
      if (!Number.isFinite(rangeAbs) || rangeAbs <= 0) {
        alert('Invalid range. Ensure Upper > Lower.');
        return;
      }

      const clampGrids = (n: number) => Math.max(2, Math.min(50, Math.floor(n)));
      let effectiveGrids = clampGrids(formData.numberOfGrids);

      if (formData.gridInputMode === 'pct') {
        const pct = Number(formData.gridPct);
        if (!Number.isFinite(pct) || pct <= 0) {
          alert('Grid % must be greater than 0');
          return;
        }
        const spacingAbsFromPct = (refPrice * pct) / 100;
        if (!Number.isFinite(spacingAbsFromPct) || spacingAbsFromPct <= 0) {
          alert('Grid % results in invalid spacing. Try a larger Grid %.');
          return;
        }
        effectiveGrids = clampGrids(Math.floor(rangeAbs / spacingAbsFromPct) + 1);
      }

      // Validate quantity based on symbol
      if (!Number.isFinite(formData.quantity) || formData.quantity < 1) {
        alert('Qty (lots) must be at least 1');
        return;
      }
      if (!Number.isInteger(formData.quantity)) {
        alert('Qty must be a whole number of lots (1, 2, 3, ...)');
        return;
      }

      if (!Number.isFinite(formData.investment) || formData.investment <= 0) {
        alert('Investment (INR) must be greater than 0');
        return;
      }

      // Compute spacing based on the effective grids
      const gridSpacingAbs = rangeAbs / (effectiveGrids - 1);
      const gridSpacingPctAtCreate = (gridSpacingAbs / refPrice) * 100;

      // Create bot configuration
      const config: GridBotConfig = {
        exchange: formData.exchange,
        execution: formData.execution,
        symbol: formData.symbol,
        lowerRange: formData.lowerRange,
        upperRange: formData.upperRange,
        numberOfGrids: effectiveGrids,
        mode: formData.mode,
        investment: formData.investment,
        quantity: formData.quantity,
        leverage: formData.leverage,
        maxPositions: formData.maxPositions,
        maxConsecutiveLoss: formData.maxConsecutiveLoss,
        circuitBreaker: Math.max(0, Math.min(100, Number(formData.circuitBreaker) || 0)),
        gridSpacing: gridSpacingAbs,
        refPriceAtCreate: refPrice,
        gridSpacingPctAtCreate: Number.isFinite(gridSpacingPctAtCreate) ? gridSpacingPctAtCreate : undefined,
      };

      if (config.execution === 'live') {
        const ok = confirm(
          `LIVE TRADING CONFIRMATION\n\nThis will allow the bot to place REAL orders on ${
            config.exchange === 'delta_global' ? 'Delta Global' : 'Delta India'
          }.\n\nProceed?`
        );
        if (!ok) return;
      }

      // Exchange constraint: only one running bot per symbol.
      const sym = (config.symbol || '').trim().toUpperCase();
      const ex = (config.exchange || 'delta_india') as any;
      const existing = await refreshBots();
      const conflict = existing.find(
        (b) =>
          b.isRunning &&
          ((b.config as any).exchange || 'delta_india') === ex &&
          (b.config.symbol || '').trim().toUpperCase() === sym
      );
      if (conflict) {
        alert(`A bot for ${sym} is already running on ${ex === 'delta_global' ? 'Delta Global' : 'Delta India'} (${conflict.name}). Stop it first before creating another bot for the same symbol on that exchange.`);
        return;
      }

      const bot = await createBot(config, `${config.symbol} Grid`);
      // Redirect to Grid Status and auto-select the newly created bot
      router.push(`/grid-status?bot=${encodeURIComponent(bot.id)}`);
    } catch (error) {
      console.error('Error creating bot:', error);
      alert('Failed to create bot. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateField = (field: keyof FormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const rangeAbs = formData.upperRange - formData.lowerRange;
  const clampGrids = (n: number) => Math.max(2, Math.min(50, Math.floor(n)));
  const spacingAbsFromPct =
    formData.gridInputMode === 'pct' &&
    refPrice !== null &&
    Number.isFinite(refPrice) &&
    refPrice > 0 &&
    Number.isFinite(formData.gridPct) &&
    formData.gridPct > 0
      ? (refPrice * formData.gridPct) / 100
      : null;
  const computedGrids =
    spacingAbsFromPct !== null && Number.isFinite(rangeAbs) && rangeAbs > 0
      ? clampGrids(Math.floor(rangeAbs / spacingAbsFromPct) + 1)
      : null;
  const effectiveGrids = formData.gridInputMode === 'pct' ? (computedGrids ?? clampGrids(formData.numberOfGrids)) : clampGrids(formData.numberOfGrids);
  const gridSpacing = Number.isFinite(rangeAbs) && rangeAbs > 0 ? rangeAbs / Math.max(1, effectiveGrids - 1) : NaN;
  const gridSpacingPctAtCreate =
    refPrice !== null && Number.isFinite(refPrice) && refPrice > 0 && Number.isFinite(gridSpacing)
      ? (gridSpacing / refPrice) * 100
      : null;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs font-medium text-slate-500">Bot</div>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Create Grid Bot</h1>
          <p className="mt-2 text-sm text-slate-600">
            Enter a symbol to preview the chart, then configure your grid on the right.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="blue">70% chart</Badge>
          <Badge tone="slate">30% config</Badge>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-10">
        {/* 70%: Chart */}
        <Card className="md:col-span-7">
          <CardHeader
            title={
              <div className="flex items-center gap-2">
                <LineChart className="h-4 w-4 text-slate-500" />
                TradingView Chart
              </div>
            }
            subtitle={
              <span>
                Symbol: <span className="font-mono">{toTradingViewSymbol(formData.symbol)}</span>
              </span>
            }
          />
          <CardBody className="p-0">
            <div className="h-[560px] w-full">
              <TradingViewChart symbol={formData.symbol || 'BTCUSD'} />
            </div>
          </CardBody>
        </Card>

        {/* 30%: Config */}
        <Card className="md:col-span-3">
          <CardHeader
            title={
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-slate-500" />
                Grid configuration
              </div>
            }
            subtitle="Create a bot with your grid + risk parameters"
          />
          <CardBody>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-2">
                <label className="text-xs font-medium text-slate-600">Exchange</label>
                <select
                  value={formData.exchange}
                  onChange={(e) => updateField('exchange', e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                >
                  <option value="delta_india">Delta Exchange India</option>
                  <option value="delta_global">Delta Exchange Global</option>
                </select>
                <div className="text-[11px] text-slate-500">
                  Bots can run on different exchanges simultaneously (requires credentials configured per exchange).
                </div>
              </div>

              <div className="grid gap-2">
                <label className="text-xs font-medium text-slate-600">Execution</label>
                <select
                  value={formData.execution}
                  onChange={(e) => updateField('execution', e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                >
                  <option value="paper">Paper (simulated)</option>
                  <option value="live">Live (real orders)</option>
                </select>
                <div className="text-[11px] text-slate-500">
                  Live mode will place real orders on the selected exchange using your API keys. Start with small size.
                </div>
              </div>

              <div className="grid gap-2">
                <label className="text-xs font-medium text-slate-600">Symbol</label>
                <input
                  value={formData.symbol}
                  onChange={(e) => updateField('symbol', e.target.value.toUpperCase())}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                  placeholder="BTCUSD"
                  required
                />
                <div className="text-[11px] text-slate-500">
                  Tip: You can paste TradingView symbol like <span className="font-mono">BINANCE:BTCUSDT</span>.
                </div>
              </div>

              <div className="grid gap-2">
                <label className="text-xs font-medium text-slate-600">Mode</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['long', 'short', 'neutral'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => updateField('mode', m)}
                      className={`rounded-lg border px-3 py-2 text-xs font-semibold capitalize transition-colors ${
                        formData.mode === m
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-medium text-slate-600">
                  Lower
                  <input
                    type="number"
                    value={formData.lowerRange}
                    onChange={(e) => updateField('lowerRange', Number.parseFloat(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    min="0"
                    step="0.00000001"
                    required
                  />
                </label>
                <label className="text-xs font-medium text-slate-600">
                  Upper
                  <input
                    type="number"
                    value={formData.upperRange}
                    onChange={(e) => updateField('upperRange', Number.parseFloat(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    min="0"
                    step="0.00000001"
                    required
                  />
                </label>
              </div>

              <div className="grid gap-2">
                <label className="text-xs font-medium text-slate-600">Grid input</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => updateField('gridInputMode', 'grids')}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                      formData.gridInputMode === 'grids'
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    No. of grids
                  </button>
                  <button
                    type="button"
                    onClick={() => updateField('gridInputMode', 'pct')}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                      formData.gridInputMode === 'pct'
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    Grid %
                  </button>
                </div>
                <div className="text-[11px] text-slate-500">
                  Uses a reference price captured at creation time (Delta ticker). Create is blocked until price loads.
                </div>
              </div>

              {formData.gridInputMode === 'grids' ? (
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs font-medium text-slate-600">
                    Grids
                    <input
                      type="number"
                      value={formData.numberOfGrids}
                      onChange={(e) => updateField('numberOfGrids', Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      min="2"
                      max="50"
                      required
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Spacing
                    <input
                      value={Number.isFinite(gridSpacing) ? formatPrice(gridSpacing) : '—'}
                      readOnly
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                    />
                  </label>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs font-medium text-slate-600">
                    Grid % (of price)
                    <input
                      type="number"
                      value={formData.gridPct}
                      onChange={(e) => updateField('gridPct', Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      min="0.0001"
                      step="0.01"
                      required
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Grids (auto)
                    <input
                      value={computedGrids === null ? '—' : String(computedGrids)}
                      readOnly
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                    />
                  </label>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Ref price (creation)</span>
                  <span className="font-semibold text-slate-900">
                    {refPrice === null ? '—' : refPrice.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-slate-600">Effective grids</span>
                  <span className="font-semibold text-slate-900">{effectiveGrids}</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-slate-600">Spacing</span>
                  <span className="font-semibold text-slate-900">
                    {Number.isFinite(gridSpacing) ? formatPrice(gridSpacing) : '—'}
                    {gridSpacingPctAtCreate === null ? '' : ` (${gridSpacingPctAtCreate.toFixed(2)}%)`}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-medium text-slate-600">
                  Qty (lots)
                  <input
                    type="number"
                    value={formData.quantity}
                    onChange={(e) => updateField('quantity', Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    min="1"
                    step="1"
                    required
                  />
                </label>
                <label className="text-xs font-medium text-slate-600">
                  Leverage
                  <input
                    type="number"
                    value={formData.leverage}
                    onChange={(e) => updateField('leverage', Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    min="1"
                    max="100"
                    required
                  />
                  <div className="mt-1 text-[11px] text-slate-500">
                    LIVE: applied on Delta as <code>order leverage</code> for this product (best-effort).
                  </div>
                </label>
              </div>

              <div className="grid gap-2">
                <label className="text-xs font-medium text-slate-600">Investment (INR)</label>
                <input
                  type="number"
                  value={formData.investment}
                  onChange={(e) => updateField('investment', Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  min="1"
                  step="1"
                  required
                />
                <div className="text-[11px] text-slate-500">
                  Baseline capital allocated to this bot (INR). Used for per-bot PnL and Current DD%.
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-medium text-slate-600">
                  Max positions
                  <input
                    type="number"
                    value={formData.maxPositions}
                    onChange={(e) => updateField('maxPositions', Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    min="1"
                    max="20"
                    required
                  />
                </label>
                <label className="text-xs font-medium text-slate-600">
                  Max losses
                  <input
                    type="number"
                    value={formData.maxConsecutiveLoss}
                    onChange={(e) => updateField('maxConsecutiveLoss', Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    min="1"
                    max="10"
                    required
                  />
                </label>
              </div>

              <div className="grid gap-2">
                <label className="text-xs font-medium text-slate-600">Circuit breaker</label>
                <input
                  type="number"
                  value={formData.circuitBreaker}
                  onChange={(e) => updateField('circuitBreaker', Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  min="0"
                  max="100"
                  step="0.1"
                  required
                />
                <div className="text-[11px] text-slate-500">
                  % drawdown from started equity to trigger emergency stop + close all positions for this symbol. Example: 5 = -5%.
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Range</span>
                  <span className="font-semibold text-slate-900">
                    {formData.lowerRange.toLocaleString()} → {formData.upperRange.toLocaleString()}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-slate-600">Grid spacing</span>
                  <span className="font-semibold text-slate-900">{Number.isFinite(gridSpacing) ? formatPrice(gridSpacing) : '—'}</span>
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <Button type="button" variant="secondary" className="flex-1" onClick={() => router.back()} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={isSubmitting}>
                  {isSubmitting ? 'Creating…' : 'Create bot'}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

