import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // config/, data/ and docs/ are read at runtime by server code.
  outputFileTracingIncludes: {
    "/**": ["./config/**/*", "./data/seed/**/*", "./docs/**/*"],
  },
};

export default nextConfig;
