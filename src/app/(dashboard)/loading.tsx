import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function DashboardLoading() {
  return (
    <div className="min-h-[50vh] w-full">
      <div className="flex items-center justify-center gap-3 py-16 text-slate-700">
        <LoadingSpinner className="h-6 w-6" />
        <div className="text-sm font-medium">Loading dashboard…</div>
      </div>
    </div>
  );
}










