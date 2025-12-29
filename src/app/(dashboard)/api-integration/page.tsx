'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

export default function ApiIntegrationPage() {
  const router = useRouter();
  const params = useSearchParams();
  const setup = params.get('setup') === '1';
  const nextPath = useMemo(() => params.get('next') || '/home', [params]);

  const [status, setStatus] = useState<'unknown' | 'ok' | 'error'>('unknown');
  const [message, setMessage] = useState<string>('Not checked yet');
  const [wallet, setWallet] = useState<Array<{ asset_symbol: string; balance: string }>>([]);
  const [credInfo, setCredInfo] = useState<any>(null);
  const [publicIp, setPublicIp] = useState<{ ipv4: string | null; ipv6: string | null } | null>(null);

  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [exchange, setExchange] = useState<'delta_india' | 'delta_global'>('delta_india');

  const [tgInfo, setTgInfo] = useState<any>(null);
  const [tgToken, setTgToken] = useState('');
  const [tgChatId, setTgChatId] = useState('');
  const [tgSaving, setTgSaving] = useState(false);
  const [tgTestSending, setTgTestSending] = useState(false);
  const [tgDetecting, setTgDetecting] = useState(false);
  const [tgSummaryMinutes, setTgSummaryMinutes] = useState<number>(0);
  const [tgSummarySaving, setTgSummarySaving] = useState(false);
  const [tgSummarySending, setTgSummarySending] = useState(false);

  const fetchJsonWithTimeout = async (url: string, init?: RequestInit, timeoutMs: number = 8000) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...(init || {}), signal: controller.signal });
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  };

  const refreshDiagnostics = async () => {
    try {
      const [cred, ip, tg, sumCfg] = await Promise.all([
        fetchJsonWithTimeout(`/api/delta/credentials?exchange=${encodeURIComponent(exchange)}`, { cache: 'no-store' }, 8000),
        fetchJsonWithTimeout('/api/system/public-ip', { cache: 'no-store' }, 4000).catch(() => null),
        fetchJsonWithTimeout('/api/alerts/telegram/config', { cache: 'no-store' }, 8000).catch(() => null),
        fetchJsonWithTimeout('/api/alerts/telegram/summary-config', { cache: 'no-store' }, 8000).catch(() => null),
      ]);
      setCredInfo(cred);
      setConfigured(!!cred?.configured);
      if (ip?.ok) setPublicIp({ ipv4: ip.ipv4 ?? null, ipv6: ip.ipv6 ?? null });
      if (tg?.ok) setTgInfo(tg);
      if (sumCfg?.ok && typeof sumCfg?.config?.intervalMinutes === 'number') setTgSummaryMinutes(sumCfg.config.intervalMinutes);
    } catch {
      // ignore
    }
  };

  const saveTelegram = async () => {
    setTgSaving(true);
    try {
      const res = await fetch('/api/alerts/telegram/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ botToken: tgToken, chatId: tgChatId }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || 'Telegram save failed');
      setTgToken('');
      // keep chatId visible as it isn't a secret
      await refreshDiagnostics();
    } catch (e: any) {
      setStatus('error');
      setMessage(e?.message || 'Telegram save failed');
    } finally {
      setTgSaving(false);
    }
  };

  const sendTelegramTest = async () => {
    setTgTestSending(true);
    try {
      const res = await fetch('/api/alerts/telegram', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `<b>9BOT Test</b>\nTelegram alerts are configured ✅` }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || 'Telegram test failed');
      setStatus('ok');
      setMessage('Telegram test sent. Check your Telegram chat.');
    } catch (e: any) {
      setStatus('error');
      setMessage(e?.message || 'Telegram test failed');
    } finally {
      setTgTestSending(false);
    }
  };

  const detectTelegramChatId = async () => {
    setTgDetecting(true);
    try {
      const res = await fetch('/api/alerts/telegram/updates?limit=10', { cache: 'no-store' });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || 'getUpdates failed');
      const arr = Array.isArray(json.result) ? json.result : [];
      const last = arr[arr.length - 1];
      const id = last?.message?.chat?.id;
      if (typeof id !== 'number' && typeof id !== 'string') throw new Error('No chat id found. Send /start to your bot first.');
      setTgChatId(String(id));
      setStatus('ok');
      setMessage('Detected chat_id from latest Telegram update. Now click Save Telegram.');
    } catch (e: any) {
      setStatus('error');
      setMessage(e?.message || 'Detect chat_id failed');
    } finally {
      setTgDetecting(false);
    }
  };

  const saveTelegramSummary = async () => {
    setTgSummarySaving(true);
    try {
      const res = await fetch('/api/alerts/telegram/summary-config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intervalMinutes: tgSummaryMinutes }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || 'Summary schedule save failed');
      setStatus('ok');
      setMessage('Telegram summary schedule saved.');
      await refreshDiagnostics();
    } catch (e: any) {
      setStatus('error');
      setMessage(e?.message || 'Summary schedule save failed');
    } finally {
      setTgSummarySaving(false);
    }
  };

  const sendTelegramSummaryNow = async () => {
    setTgSummarySending(true);
    try {
      const res = await fetch('/api/alerts/telegram/summary', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || 'Summary send failed');
      setStatus('ok');
      setMessage('Telegram summary sent.');
    } catch (e: any) {
      setStatus('error');
      setMessage(e?.message || 'Summary send failed');
    } finally {
      setTgSummarySending(false);
    }
  };

  const check = async () => {
    setStatus('unknown');
    setMessage('Checking…');
    try {
      // Diagnostics are best-effort and should never block the main "wallet check" UX.
      void refreshDiagnostics().catch(() => {});

      const res = await fetch('/api/delta/wallet', { cache: 'no-store' });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Delta wallet failed');
      setWallet(Array.isArray(json.result) ? json.result : []);
      setStatus('ok');
      setMessage('Connected to Delta (wallet endpoint OK)');
    } catch (e: any) {
      setStatus('error');
      setMessage(e?.message || 'Connection failed');
      setWallet([]);
    }
  };

  const saveOnce = async () => {
    setSaving(true);
    try {
      // Set active exchange cookie first (so the subsequent validation uses the same one).
      await fetch('/api/system/active-exchange', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ exchange }),
      });

      const res = await fetch('/api/delta/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ exchange, apiKey, apiSecret, baseUrl }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Save failed');
      setApiKey('');
      setApiSecret('');
      setConfigured(true);
      await check();
      router.replace(nextPath);
    } catch (e: any) {
      setStatus('error');
      setMessage(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/system/active-exchange', { cache: 'no-store' });
        const json = await res.json().catch(() => null);
        const ex = json?.exchange;
        if (ex === 'delta_india' || ex === 'delta_global') setExchange(ex);
      } catch {
        // ignore
      } finally {
        void check();
      }
    })();
  }, []);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="text-xs font-medium text-slate-500">Settings</div>
      <h1 className="mt-1 text-2xl font-semibold text-slate-900">API Integration</h1>
      <p className="mt-2 text-sm text-slate-600">
        This app connects to Delta Exchange through server-side API routes.
      </p>
      <p className="mt-2 text-sm text-slate-600">
        One-time setup: if credentials are not saved yet, enter them below. We store them on the server in a local file (dev-only) so we don’t ask again.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Exchange connection"
            subtitle="Select an exchange and validate by calling /api/delta/wallet (signed request)."
            right={
              <div className="flex items-center gap-2">
                {status === 'ok' ? <Badge tone="green">Connected</Badge> : status === 'error' ? <Badge tone="red">Error</Badge> : <Badge tone="slate">Checking</Badge>}
                <Button variant="secondary" onClick={check}>Re-check</Button>
              </div>
            }
          />
          <CardBody>
            <div className="mb-4 grid gap-2">
              <label className="text-xs text-slate-600">
                Exchange
                <select
                  value={exchange}
                  onChange={async (e) => {
                    const ex = e.target.value as any;
                    setExchange(ex);
                    // Default base URLs for convenience
                    if (ex === 'delta_india') setBaseUrl('https://api.india.delta.exchange');
                    if (ex === 'delta_global') setBaseUrl('https://api.delta.exchange');
                    await fetch('/api/system/active-exchange', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ exchange: ex }),
                    });
                    await check();
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="delta_india">Delta Exchange India</option>
                  <option value="delta_global">Delta Exchange Global</option>
                </select>
              </label>
              <div className="text-[11px] text-slate-500">
                You can configure multiple exchanges; switching here will route all API calls to the selected exchange.
              </div>
            </div>

            <div className="text-sm text-slate-700">{message}</div>
            {status === 'error' ? (
              <div className="mt-3 text-xs text-slate-500">
                Common causes: wrong keys, wrong Delta base URL (India vs global), or missing permissions.
              </div>
            ) : null}

            <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Connection health</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Useful for IP whitelist + auth debugging.
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={refreshDiagnostics}>Refresh</Button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Delta base URL</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {credInfo?.baseUrl || '—'}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Source: <span className="font-semibold">{credInfo?.source || '—'}</span> · Key: <span className="font-semibold">{credInfo?.apiKeyMasked || '—'}</span>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Public IP (for whitelist)</div>
                  <div className="mt-1 text-sm text-slate-900">
                    <div><span className="text-xs text-slate-500">IPv4:</span> <span className="font-semibold">{publicIp?.ipv4 || '—'}</span></div>
                    <div className="mt-1"><span className="text-xs text-slate-500">IPv6:</span> <span className="font-semibold">{publicIp?.ipv6 || '—'}</span></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Telegram alerts</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Create a bot with <span className="font-mono">BotFather</span>, then paste the token + your chat_id here (stored server-side, dev-only).
                  </div>
                </div>
                <Badge tone={tgInfo?.configured ? 'green' : 'slate'}>{tgInfo?.configured ? 'Configured' : 'Not configured'}</Badge>
              </div>

              <div className="mt-4 grid gap-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  <div><span className="text-slate-500">Source:</span> <span className="font-semibold">{tgInfo?.source || '—'}</span></div>
                  <div className="mt-1"><span className="text-slate-500">Token:</span> <span className="font-semibold">{tgInfo?.botTokenMasked || '—'}</span></div>
                  <div className="mt-1"><span className="text-slate-500">Chat ID:</span> <span className="font-semibold">{tgInfo?.chatId || '—'}</span></div>
                </div>

                <label className="text-xs text-slate-600">
                  BotFather token
                  <input
                    value={tgToken}
                    onChange={(e) => setTgToken(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    placeholder="123456789:ABCDEF..."
                  />
                </label>

                <label className="text-xs text-slate-600">
                  chat_id
                  <input
                    value={tgChatId}
                    onChange={(e) => setTgChatId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    placeholder="e.g. 123456789 or -100... or @channelusername"
                  />
                  <div className="mt-1 text-[11px] text-slate-500">
                    Tip: send <span className="font-mono">/start</span> to your bot, then click “Detect chat_id”.
                  </div>
                </label>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={saveTelegram} disabled={tgSaving || !tgToken || !tgChatId}>
                    {tgSaving ? 'Saving…' : 'Save Telegram'}
                  </Button>
                  <Button variant="secondary" onClick={detectTelegramChatId} disabled={tgDetecting}>
                    {tgDetecting ? 'Detecting…' : 'Detect chat_id'}
                  </Button>
                  <Button variant="secondary" onClick={sendTelegramTest} disabled={tgTestSending || !tgInfo?.configured}>
                    {tgTestSending ? 'Sending…' : 'Send test'}
                  </Button>
                  <a
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
                    href="/api/alerts/telegram/updates?limit=5"
                    target="_blank"
                    rel="noreferrer"
                  >
                    View updates
                  </a>
                </div>

                <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="text-xs font-semibold text-slate-700">Telegram summary schedule</div>
                  <div className="mt-2 grid gap-2 md:grid-cols-3 md:items-end">
                    <label className="text-xs text-slate-600 md:col-span-2">
                      Send summary every
                      <select
                        value={String(tgSummaryMinutes)}
                        onChange={(e) => setTgSummaryMinutes(Number(e.target.value))}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      >
                        <option value="0">Off</option>
                        <option value="5">5 minutes</option>
                        <option value="15">15 minutes</option>
                        <option value="60">1 hour</option>
                        <option value="240">4 hours</option>
                        <option value="1440">24 hours</option>
                      </select>
                      <div className="mt-1 text-[11px] text-slate-500">
                        Includes total bots + per-bot symbol, initial capital, and PnL snapshot.
                      </div>
                    </label>
                    <div className="flex gap-2">
                      <Button onClick={saveTelegramSummary} disabled={tgSummarySaving}>
                        {tgSummarySaving ? 'Saving…' : 'Save schedule'}
                      </Button>
                      <Button variant="secondary" onClick={sendTelegramSummaryNow} disabled={tgSummarySending || !tgInfo?.configured}>
                        {tgSummarySending ? 'Sending…' : 'Send now'}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {(setup || !configured) ? (
              <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">Enter Delta API credentials (one-time)</div>
                <div className="mt-3 grid gap-3">
                  <label className="text-xs text-slate-600">
                    Delta Base URL (optional)
                    <input
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder="https://api.delta.exchange"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                    <div className="mt-1 text-[11px] text-slate-500">If you use Delta India, put the correct API domain here.</div>
                  </label>
                  <label className="text-xs text-slate-600">
                    API Key
                    <input
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                  </label>
                  <label className="text-xs text-slate-600">
                    API Secret
                    <input
                      value={apiSecret}
                      onChange={(e) => setApiSecret(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                  </label>
                  <div className="flex gap-2">
                    <Button onClick={saveOnce} disabled={saving || !apiKey || !apiSecret}>
                      {saving ? 'Saving…' : 'Save & Validate'}
                    </Button>
                    <Button variant="secondary" onClick={() => router.replace(nextPath)}>
                      Skip
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 text-xs text-slate-500">
                Credentials already configured. You won’t be asked again.
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Wallet balances" subtitle="From Delta wallet endpoint" />
          <CardBody className="space-y-2">
            {wallet.length ? (
              wallet.slice(0, 8).map((b) => (
                <div key={b.asset_symbol} className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">{b.asset_symbol}</span>
                  <span className="font-semibold text-slate-900">{Number(b.balance).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                </div>
              ))
            ) : (
              <div className="text-sm text-slate-500">No data</div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}


