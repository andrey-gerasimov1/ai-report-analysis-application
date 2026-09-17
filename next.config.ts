import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Lets CI or local QA build beside a running dev server when needed.
  distDir: process.env.REPORT_ANALYSIS_NEXT_DIST_DIR || ".next",
};

export default nextConfig;
