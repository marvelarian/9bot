import { Card, CardBody, CardHeader } from '@/components/ui/Card';

export default function StrategyBuilderPage() {
  return (
    <div className="max-w-7xl mx-auto">
      <div className="text-xs font-medium text-slate-500">Bot</div>
      <h1 className="mt-1 text-2xl font-semibold text-slate-900">Strategy Builder</h1>
      <p className="mt-2 text-sm text-slate-600">Rule builder UI (placeholder). Next step: level-cross rules + actions.</p>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Rules" subtitle="When price crosses a level, choose actions." />
          <CardBody>
            <div className="text-sm text-slate-600">Coming soon…</div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Preview" subtitle="How your rules will behave." />
          <CardBody>
            <div className="text-sm text-slate-600">Coming soon…</div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}


