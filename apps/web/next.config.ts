import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    viewTransition: true,
  },
  turbopack: {
    root: new URL("../..", import.meta.url).pathname,
  },
  transpilePackages: ["@aripabot/core"],
};

export default nextConfig;
