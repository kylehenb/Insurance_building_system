import type { NextConfig } from "next";

// Files read from disk at runtime by PDF routes. Vercel only ships what the
// tracer finds, so each route that renders or stamps a PDF is listed here.
const CHROMIUM_FILES = [
  "./node_modules/@sparticuz/chromium/bin/**",
  "./lib/pdf/fonts/*.ttf",
];
const DOCUMENT_IMAGES = ["./public/logo-pdf.png", "./public/logo-alt.png", "./public/signature.png"];
const SIGNING_FONTS = ["./lib/signing/fonts/*.ttf", "./lib/pdf/fonts/*.ttf"];

// Full puppeteer is a devDependency used only for local rendering.
const NO_FULL_PUPPETEER = ["./node_modules/puppeteer/**"];

const nextConfig: NextConfig = {
  // Headless Chromium for server-side PDF rendering (lib/pdf/render-html-to-pdf.ts).
  // Loaded with native require so the Chromium binary and its brotli archives
  // stay as files on disk instead of being bundled.
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
  outputFileTracingIncludes: {
    "/api/work-orders/\\[id\\]/pdf": [...CHROMIUM_FILES, ...DOCUMENT_IMAGES],
    // Send & Lock renders the work order PDF too
    "/api/work-orders/\\[id\\]/send": [...CHROMIUM_FILES, ...DOCUMENT_IMAGES],
    // E-signing: generates the document when a request is created…
    "/api/signing/jobs/\\[jobId\\]/requests": [...CHROMIUM_FILES, ...DOCUMENT_IMAGES],
    // Resend re-renders the excess invoice PDF if its stored copy is missing
    "/api/signing/requests/\\[id\\]/\\[action\\]": [...CHROMIUM_FILES, ...DOCUMENT_IMAGES],
    // …and stamps the signature + certificate when the homeowner signs
    "/api/sign/\\[token\\]/submit": SIGNING_FONTS,
    "/api/sign/fonts/\\[style\\]": SIGNING_FONTS,
  },
  outputFileTracingExcludes: {
    "/api/work-orders/\\[id\\]/pdf": NO_FULL_PUPPETEER,
    "/api/work-orders/\\[id\\]/send": NO_FULL_PUPPETEER,
    "/api/signing/jobs/\\[jobId\\]/requests": NO_FULL_PUPPETEER,
    "/api/signing/requests/\\[id\\]/\\[action\\]": NO_FULL_PUPPETEER,
  },
  async headers() {
    // Signing links carry a secret token in the URL: never leak it in a
    // Referer header, never index. (Each signing route sets its own
    // Cache-Control: pages and PDFs no-store, fonts cacheable.)
    const signingHeaders = [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ];
    return [
      { source: "/sign/:path*", headers: signingHeaders },
      { source: "/api/sign/:path*", headers: signingHeaders },
    ];
  },
};

export default nextConfig;
