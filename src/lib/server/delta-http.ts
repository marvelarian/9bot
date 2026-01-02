// Server-only Delta HTTP helper that forces IPv4 egress (no extra deps).
// We force IPv4 by overriding DNS lookup to `family: 4`.

import dns from 'dns';
import https from 'https';

export async function requestJsonIPv4(params: {
  url: string;
  method: 'GET' | 'POST' | 'DELETE';
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; status: number; json: any }> {
  const timeoutMs = typeof params.timeoutMs === 'number' ? params.timeoutMs : 15_000;
  const u = new URL(params.url);

  return await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port ? Number(u.port) : 443,
        path: `${u.pathname}${u.search}`,
        method: params.method,
        headers: params.headers,
        // Force IPv4 resolution
        lookup: (hostname, opts: any, cb: any) => {
          const base =
            typeof opts === 'number'
              ? { family: opts }
              : opts && typeof opts === 'object'
                ? opts
                : {};
          dns.lookup(hostname, { ...base, family: 4 }, cb);
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))));
        res.on('end', () => {
          const status = res.statusCode || 0;
          const text = Buffer.concat(chunks).toString('utf8');
          let json: any = {};
          try {
            json = text ? JSON.parse(text) : {};
          } catch {
            json = { message: text || '<non-json response>' };
          }
          resolve({ ok: status >= 200 && status < 300, status, json });
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      try {
        req.destroy(new Error('delta request timeout'));
      } catch {
        // ignore
      }
    });

    if (params.body) req.write(params.body);
    req.end();
  });
}


