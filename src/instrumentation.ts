export async function register() {
  // The bot worker requires Node.js built-ins (fs/crypto) and must NOT run in the Edge runtime.
  if (process.env.NEXT_RUNTIME === 'edge') return;

  // EC2-only worker (enabled via env vars)
  try {
    const mod = await import('@/lib/server/bot-worker');
    mod.startBotWorker();
  } catch {
    // best-effort: never block Next startup
  }
}



