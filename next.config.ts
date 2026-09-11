import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["argon2"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
