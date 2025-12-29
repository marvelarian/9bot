export const runtime = 'nodejs';

async function fetchText(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) throw new Error(`ip lookup failed: ${res.status}`);
  return (await res.text()).trim();
}

export async function GET() {
  try {
    // Best-effort: many ISPs switch between IPv4/IPv6; show both if possible.
    const [ipv4, ipv6] = await Promise.allSettled([
      fetchText('https://api.ipify.org', 2500),
      fetchText('https://api64.ipify.org', 2500),
    ]);

    return Response.json({
      ok: true,
      ipv4: ipv4.status === 'fulfilled' ? ipv4.value : null,
      ipv6: ipv6.status === 'fulfilled' ? ipv6.value : null,
    });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || 'unknown' }, { status: 500 });
  }
}






