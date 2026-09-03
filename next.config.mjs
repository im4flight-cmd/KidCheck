/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A unique id per deploy, baked into both the client and the server at build
  // time. The classroom display compares the id it booted with against the id
  // the server currently reports, and reloads itself when a new version ships,
  // so the iPads pick up updates on their own without anyone touching them.
  env: {
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now()),
  },
  // The roster is always live data, never statically cached.
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
    ];
  },
};

export default nextConfig;
