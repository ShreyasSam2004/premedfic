import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Portal links carry access tokens in the URL; never leak them via Referer.
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" },
  { key: "Permissions-Policy", value: "geolocation=(), microphone=(), payment=()" },
];

const nextConfig: NextConfig = {
  // Database drivers and PDF tooling load WASM / native assets at runtime and must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "unpdf", "pdf-lib"],
  // The demo reset applies migrations at runtime, so the SQL files ship with it.
  outputFileTracingIncludes: { "/api/admin/reset-demo": ["./drizzle/**/*"] },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
