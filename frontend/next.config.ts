import type { NextConfig } from "next";

// In production the browser talks only to the front end's own address: every
// request to /api/* is forwarded to the backend (BACKEND_URL). The login cookie
// is then first-party, so browsers that block cross-site cookies (Safari, Brave,
// Chrome) still keep the student signed in. Locally BACKEND_URL is unset and the
// app calls NEXT_PUBLIC_API_URL (http://localhost:8000) directly, as before.
const backendUrl = process.env.BACKEND_URL?.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    if (!backendUrl) {
      return [];
    }

    return [{ source: "/api/:path*", destination: `${backendUrl}/:path*` }];
  },
  experimental: {
    // A cited answer can take several seconds; the default proxy limit is 30 s.
    proxyTimeout: 60_000,
  },
};

export default nextConfig;
