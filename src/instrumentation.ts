import { startBotWorker } from '@/lib/server/bot-worker';

export function register() {
  // EC2-only worker (enabled via env vars)
  try {
    startBotWorker();
  } catch {
    // best-effort: never block Next startup
  }
}


