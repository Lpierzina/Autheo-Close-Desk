import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The whole app is static files. There is no server runtime, so there is nowhere for a
  // deal file to be sent: `npm run build` writes the site to out/.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  // Keeps `next dev` from writing an AGENTS.md into the repository.
  agentRules: false,
  devIndicators: false,
};

export default nextConfig;
