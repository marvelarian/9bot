import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Sparkline } from '@/components/charts/Sparkline';

export default function PerformancePage() {
  const data = [10000, 10020, 9990, 10060, 10110, 10070, 10190, 10260];

  return (
    <div className="max-w-7xl mx-auto">
      <div className="text-xs font-medium text-slate-500">Home</div>
      <h1 className="mt-1 text-2xl font-semibold text-slate-900">Performance</h1>
      <p className="mt-2 text-sm text-slate-600">Equity curve, PnL and drawdown (placeholder UI).</p>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Equity curve" subtitle="Demo data – will become real once we connect live fills + positions." />
          <CardBody>
            <Sparkline data={data} width={700} height={140} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Key metrics" subtitle="Last 30 days" />
          <CardBody className="space-y-2 text-sm text-slate-700">
            <div className="flex justify-between"><span>Net PnL</span><span className="font-semibold text-emerald-700">+$260</span></div>
            <div className="flex justify-between"><span>Max drawdown</span><span className="font-semibold text-slate-900">-1.2%</span></div>
            <div className="flex justify-between"><span>Win rate</span><span className="font-semibold text-slate-900">58%</span></div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}


