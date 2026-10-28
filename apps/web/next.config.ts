import type { NextConfig } from "next";

// NEXT_STATIC_EXPORT=1 builds a static `out/` for the VPS (nginx serves it and proxies
// /v1/copilot/ to uvicorn). The Node proxy route is named `route.proxy.ts`, so it is
// only picked up when `proxy.ts` is a page extension, i.e. in the normal build and dev.
const staticExport = process.env.NEXT_STATIC_EXPORT === "1";
const basePageExtensions = ["tsx", "ts", "jsx", "js"];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: staticExport ? "export" : "standalone",
  pageExtensions: staticExport ? basePageExtensions : [...basePageExtensions, "proxy.ts"],
  allowedDevOrigins: [
    "*.ngrok-free.dev",
    "*.ngrok-free.app",
    "*.ngrok.app",
    "*.ngrok.io",
  ],
};

export default nextConfig;
