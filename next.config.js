/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ensure `src/instrumentation.ts` runs in production (used for the 24/7 bot worker).
  // Safe to keep enabled across Next versions; ignored if already stable.
  experimental: {
    instrumentationHook: true,
  },
  webpack: (config, { dev, isServer, nextRuntime }) => {
    // On Windows, webpack filesystem cache can cause stale chunks / ChunkLoadError during dev.
    // Disable it to stabilize navigation (at the cost of slightly slower rebuilds).
    if (dev) {
      config.cache = false;
    }

    // The bot worker runs in Node.js, but Next may scan server files during:
    // - the client build, and/or
    // - the Edge server build (NEXT_RUNTIME === 'edge')
    //
    // Prevent those compilations from failing on Node built-ins.
    if (!isServer || nextRuntime === 'edge') {
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        dns: false,
        fs: false,
        https: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },
}

module.exports = nextConfig

