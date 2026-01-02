'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export default function ProfilePage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        const json = await res.json().catch(() => null);
        if (!alive) return;
        if (!json?.ok) {
          router.replace('/login?next=%2Fprofile');
          return;
        }
        setEmail(String(json.email || json.user?.email || ''));
      } catch {
        if (!alive) return;
        router.replace('/login?next=%2Fprofile');
      } finally {
        if (alive) setLoading(false);
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [router]);

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    router.replace('/login');
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Profile</h1>
        <p className="text-gray-600">Account information</p>
      </div>

      <Card>
        <CardHeader title="Account" subtitle="Your current logged-in session" />
        <CardBody>
          <div className="grid gap-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs text-slate-500">Email</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {loading ? 'Loading…' : email || '—'}
              </div>
            </div>

            <div className="flex justify-end">
              <Button variant="secondary" onClick={logout}>
                Logout
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}



