'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { deleteBot, getActivity, getBots, refreshActivity, refreshBots, stopBotsByExchange, updateBot, type ActivityEvent, type BotRecord } from '@/lib/bot-store';
import { fetchEquitySnapshot } from '@/lib/equity';
import { AlertTriangle, Pause, Play, Plus, Trash2 } from 'lucide-react';

export default function BotControlPage() {
  const [bots, setBots] = useState<BotRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    // initial load from server
    void (async () => {
      try {
        const b = await refreshBots();
        setBots(b);
        setSelectedId(b[0]?.id ?? null);
      } catch {
        setBots(getBots());
      }
      try {
        const a = await refreshActivity();
        setActivity(a);
      } catch {
        setActivity(getActivity());
      }
    })();
  }, []);

  useEffect(() => {
    const refreshFromCache = () => {
      const nextBots = getBots();
      setBots(nextBots);
      setActivity(getActivity());
      setSelectedId((prev) => {
        if (prev && nextBots.some((b) => b.id === prev)) return prev;
        return nextBots[0]?.id ?? null;
      });
    };
    refreshFromCache();
    window.addEventListener('activity:changed', refreshFromCache);
    window.addEventListener('bots:changed', refreshFromCache);
    return () => {
      window.removeEventListener('activity:changed', refreshFromCache);
      window.removeEventListener('bots:changed', refreshFromCache);
    };
  }, []);

  const selected = useMemo(() => bots.find((b) => b.id === selectedId) || null, [bots, selectedId]);

  const emergencyStopExchange = () => {
    const ex = (((selected?.config as any)?.exchange || 'delta_india') as 'delta_india' | 'delta_global');
    const label = ex === 'delta_global' ? 'Delta Global' : 'Delta India';
    const ok = confirm(`Emergency stop will STOP ALL BOTS on ${label}. Continue?`);
    if (!ok) return;
    void stopBotsByExchange(ex).catch(() => null);
  };

  const toggle = async (id: string) => {
    const b = bots.find((x) => x.id === id);
    if (!b) return;
    if (!b.isRunning) {
      const sym = (b.config.symbol || '').trim().toUpperCase();
      const ex = ((b.config as any).exchange || 'delta_india') as any;
      const conflict = bots.find(
        (x) =>
          x.id !== id &&
          x.isRunning &&
          ((x.config as any).exchange || 'delta_india') === ex &&
          (x.config.symbol || '').trim().toUpperCase() === sym
      );
      if (conflict) {
        alert(`A bot for ${sym} is already running on ${ex === 'delta_global' ? 'Delta Global' : 'Delta India'}. Stop it first (bot: ${conflict.name}).`);
        return;
      }
    }
    if (!b.isRunning) {
      try {
        const snap = await fetchEquitySnapshot(((b.config as any).exchange || 'delta_india') as any);
        const next = await updateBot(id, {
          isRunning: true,
          runtime: { startedAt: Date.now(), startedEquity: snap.value, startedCurrency: snap.label },
        });
        if (!next) {
          const sym = (b.config.symbol || '').trim().toUpperCase();
          alert(`A bot for ${sym} is already running. Stop it first.`);
          return;
        }
        setBots((prev) => prev.map((x) => (x.id === id ? next : x)));
        return;
      } catch {
        // If equity snapshot fails, still allow start (best-effort metrics).
      }
    }

    const next = await updateBot(id, { isRunning: !b.isRunning });
    if (!next) {
      const sym = (b.config.symbol || '').trim().toUpperCase();
      alert(`A bot for ${sym} is already running. Stop it first.`);
      return;
    }
    setBots((prev) => prev.map((x) => (x.id === id ? next : x)));
  };

  const remove = (id: string) => {
    void deleteBot(id).catch(() => null);
    setBots((prev) => prev.filter((x) => x.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs font-medium text-slate-500">Bot</div>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Control Panel</h1>
          <p className="mt-2 text-sm text-slate-600">
            Start/stop bots, view config summary, and manage bots.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/bot/create">
            <Button>
              <Plus className="h-4 w-4" />
              Create bot
            </Button>
          </Link>
          <Button
            variant="danger"
            onClick={emergencyStopExchange}
            disabled={!selected}
            title={!selected ? 'Select a bot to choose which exchange to stop' : undefined}
          >
            <AlertTriangle className="h-4 w-4" />
            Emergency stop ({(((selected?.config as any)?.exchange || 'delta_india') as any) === 'delta_global' ? 'Delta Global' : 'Delta India'})
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Bots" subtitle="Your saved bots (stored locally for now)" />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Name</th>
                    <th className="px-5 py-3 text-left font-medium">Symbol</th>
                    <th className="px-5 py-3 text-left font-medium">Mode</th>
                    <th className="px-5 py-3 text-left font-medium">Status</th>
                    <th className="px-5 py-3 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bots.map((b) => {
                    const active = b.id === selectedId;
                    return (
                      <tr
                        key={b.id}
                        className={`cursor-pointer ${active ? 'bg-slate-50' : 'hover:bg-slate-50/70'}`}
                        onClick={() => setSelectedId(b.id)}
                      >
                        <td className="px-5 py-4 font-semibold text-slate-900">{b.name}</td>
                        <td className="px-5 py-4 text-slate-700">
                          <Link
                            href={`/grid-status?bot=${encodeURIComponent(b.id)}`}
                            className="font-semibold text-slate-900 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {b.config.symbol}
                          </Link>
                        </td>
                        <td className="px-5 py-4 capitalize text-slate-700">{b.config.mode}</td>
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            {b.isRunning ? <Badge tone="green">Running</Badge> : <Badge tone="slate">Stopped</Badge>}
                            {(((b.config as any).execution || 'paper') as 'paper' | 'live') === 'live' ? (
                              <Badge tone="red">LIVE</Badge>
                            ) : (
                              <Badge tone="slate">PAPER</Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="inline-flex items-center gap-2">
                            <Button
                              size="sm"
                              variant={b.isRunning ? 'danger' : 'primary'}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggle(b.id);
                              }}
                            >
                              {b.isRunning ? (
                                <>
                                  <Pause className="h-4 w-4" /> Stop
                                </>
                              ) : (
                                <>
                                  <Play className="h-4 w-4" /> Start
                                </>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={(e) => {
                                e.stopPropagation();
                                const ok = confirm(`Delete bot "${b.name}"?`);
                                if (!ok) return;
                                remove(b.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4" /> Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {bots.length === 0 ? (
                    <tr>
                      <td className="px-5 py-10 text-center text-slate-500" colSpan={5}>
                        No bots yet. Create your first bot.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>

        <div className="grid gap-4">
          <Card>
            <CardHeader title="Recent activity" subtitle="Bot events (local)" right={<Badge tone="slate">{activity.length}</Badge>} />
            <CardBody className="space-y-2">
              {activity.length ? (
                activity.slice(0, 8).map((a) => (
                  <div key={a.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900">
                        {a.type === 'bot.created'
                          ? `Created ${a.name || a.symbol || 'bot'}`
                          : a.type === 'bot.started'
                            ? `Started ${a.name || a.symbol || 'bot'}`
                            : a.type === 'bot.stopped'
                              ? `Stopped ${a.name || a.symbol || 'bot'}`
                              : a.type === 'bot.deleted'
                                ? `Deleted ${a.name || a.symbol || 'bot'}`
                                : `Emergency stop: ${a.exchange ? (a.exchange === 'delta_global' ? 'Delta Global' : 'Delta India') : 'all bots'}`}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{new Date(a.ts).toLocaleString()}</div>
                    </div>
                    <Badge tone={a.type === 'bot.started' ? 'green' : a.type === 'bot.stopped' || a.type === 'bot.deleted' ? 'red' : a.type === 'bot.created' ? 'blue' : 'yellow'}>
                      {a.type}
                    </Badge>
                  </div>
                ))
              ) : (
                <div className="text-sm text-slate-500">No activity yet.</div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}


