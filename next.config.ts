import type { NextConfig } from "next";
import { brandVersion } from "./lib/brand";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  images: {
    localPatterns: [
      { pathname: "/**", search: "" },
      { pathname: "/jiawenlex-icon.png", search: `?v=${brandVersion}` },
    ],
  },
};

export default nextConfig;
