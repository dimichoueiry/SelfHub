import type { NextConfig } from "next";

// Where the SelfHub API runs. The browser calls same-origin /selfhub-api/*, and Next proxies
// it here, so the API's CORS list doesn't matter. 8787 is reserved for AgentGrid locally.
const apiUrl = (process.env.NEXT_PUBLIC_SELFHUB_API_URL ?? "http://localhost:8788").replace(/\/$/, "");

// The dashboard is a client-rendered app over the SelfHub API (or the in-browser mock),
// so it does not opt into Cache Components / partial prefetching.
const nextConfig: NextConfig = {
  // Lets the live (http) build sit next to the mock build: NEXT_DIST_DIR=.next-live.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [{ source: "/selfhub-api/:path*", destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;
