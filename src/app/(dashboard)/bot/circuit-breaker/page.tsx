import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export default function CircuitBreakerPage() {
  return (
    <div className="max-w-7xl mx-auto">
      <div className="text-xs font-medium text-slate-500">Bot</div>
      <h1 className="mt-1 text-2xl font-semibold text-slate-900">Circuit Breaker</h1>
      <p className="mt-2 text-sm text-slate-600">Stop trading automatically when risk thresholds are hit.</p>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Rules" subtitle="These will be configurable per bot (placeholder)." />
          <CardBody className="space-y-3 text-sm text-slate-700">
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
              <span>Max consecutive losses</span>
              <Badge tone="blue">Enabled</Badge>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
              <span>Daily loss limit</span>
              <Badge tone="blue">Enabled</Badge>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
              <span>Emergency circuit breaker</span>
              <Badge tone="green">Healthy</Badge>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Status" subtitle="System-wide health summary." />
          <CardBody className="text-sm text-slate-700">
            <div className="flex items-center justify-between">
              <span>Triggered</span>
              <Badge tone="green">No</Badge>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}


