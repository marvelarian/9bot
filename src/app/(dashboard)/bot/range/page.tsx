import { Card, CardBody, CardHeader } from '@/components/ui/Card';

export default function RangeDetectionPage() {
  return (
    <div className="max-w-7xl mx-auto">
      <div className="text-xs font-medium text-slate-500">Bot</div>
      <h1 className="mt-1 text-2xl font-semibold text-slate-900">Range Detection</h1>
      <p className="mt-2 text-sm text-slate-600">Auto-suggest grid ranges based on recent volatility (placeholder).</p>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Suggested ranges" subtitle="Will use historical candles once wired to Delta." />
          <CardBody>
            <div className="text-sm text-slate-600">Coming soon…</div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Inputs" subtitle="Symbol, timeframe, lookback." />
          <CardBody>
            <div className="text-sm text-slate-600">Coming soon…</div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}


