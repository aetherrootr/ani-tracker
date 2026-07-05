import type { NextConfig } from "next";

const enableLanDev = process.env.ENABLE_LAN_DEV === "1";

const nextConfig: NextConfig = {
  ...(enableLanDev
    ? {
        allowedDevOrigins: [
          "localhost",
          "127.0.0.1",
          "192.168.*.*",
          "10.*.*.*",
          "172.16.*.*",
          "172.17.*.*",
          "172.18.*.*",
          "172.19.*.*",
          "172.20.*.*",
          "172.21.*.*",
          "172.22.*.*",
          "172.23.*.*",
          "172.24.*.*",
          "172.25.*.*",
          "172.26.*.*",
          "172.27.*.*",
          "172.28.*.*",
          "172.29.*.*",
          "172.30.*.*",
          "172.31.*.*",
        ],
      }
    : {}),
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3001"}/api/:path*`,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "placehold.co",
      },
    ],
  },
};

export default nextConfig;
