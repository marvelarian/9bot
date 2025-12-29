// Server-only side effect: prefer IPv4 so Delta whitelisting remains stable.
//
// Why: many ISPs give both IPv4 and IPv6; Node/undici may pick IPv6 sometimes,
// so Delta sees a different `client_ip` and rejects the key.
//
// This module is imported dynamically from server code (never from the browser).

import dns from 'node:dns';

let applied = false;

export function ensureIPv4Preferred() {
  if (applied) return;
  applied = true;

  // 1) Prefer A records over AAAA records when resolving hostnames.
  try {
    (dns as any).setDefaultResultOrder?.('ipv4first');
  } catch {
    // ignore
  }

  // 2) Force undici (Node fetch) to connect using IPv4.
  // This is stronger than dns order (avoids "happy eyeballs" choosing IPv6).
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const undici = require('undici') as typeof import('undici');
    if (undici?.Agent && undici?.setGlobalDispatcher) {
      undici.setGlobalDispatcher(
        new undici.Agent({
          connect: { family: 4 },
        })
      );
    }
  } catch {
    // ignore
  }
}

// Apply on import.
ensureIPv4Preferred();





