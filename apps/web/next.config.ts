import type { NextConfig } from "next";

const COPILOT_UPSTREAM = process.env.COPILOT_UPSTREAM_URL || "http://127.0.0.1:8000";

/** Same-origin rewrite only when the browser is not configured to call copilot directly. */
function shouldProxyCopilotToUpstream(): boolean {
  const publicUrl = process.env.NEXT_PUBLIC_COPILOT_URL;
  if (publicUrl === undefined || publicUrl === null) return true;
  return publicUrl.trim() === "";
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Let ngrok (and similar tunnels) load Next dev assets / HMR.
  allowedDevOrigins: [
    "*.ngrok-free.dev",
    "*.ngrok-free.app",
    "*.ngrok.app",
    "*.ngrok.io",
  ],
  async rewrites() {
    if (!shouldProxyCopilotToUpstream()) {
      return [];
    }
    return [
      {
        source: "/v1/copilot/:path*",
        destination: `${COPILOT_UPSTREAM.replace(/\/$/, "")}/v1/copilot/:path*`,
      },
    ];
  },
};

export default nextConfig;
