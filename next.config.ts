import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Headless Chromium for server-side PDF rendering (lib/pdf/render-html-to-pdf.ts).
  // Loaded with native require so the Chromium binary and its brotli archives
  // stay as files on disk instead of being bundled.
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
  outputFileTracingIncludes: {
    "/api/work-orders/\\[id\\]/pdf": [
      "./node_modules/@sparticuz/chromium/bin/**",
      "./public/logo-pdf.png",
    ],
  },
  outputFileTracingExcludes: {
    // Full puppeteer is a devDependency used only for local rendering.
    "/api/work-orders/\\[id\\]/pdf": ["./node_modules/puppeteer/**"],
  },
};

export default nextConfig;
