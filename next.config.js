/** @type {import('next').NextConfig} */
const nextConfig = {
  // Using the App Router (`src/app`) - no experimental flag needed in Next 14+
  webpack: (config, { dev }) => {
    // On Windows, webpack filesystem cache can cause stale chunks / ChunkLoadError during dev.
    // Disable it to stabilize navigation (at the cost of slightly slower rebuilds).
    if (dev) {
      config.cache = false;
    }
    return config;
  },
}

module.exports = nextConfig

