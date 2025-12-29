import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function AuthLoading() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-white">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex items-center justify-center gap-3 py-20 text-slate-200">
          <LoadingSpinner className="h-6 w-6 border-slate-600 border-t-white" />
          <div className="text-sm font-medium">Loading…</div>
        </div>
      </div>
    </main>
  );
}










