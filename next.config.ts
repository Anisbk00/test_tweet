import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // For Vercel deployment, remove "standalone" output
  // Vercel handles the build output automatically
  output: process.env.VERCEL ? undefined : "standalone",
  
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  
  // Allow external image domains (Twitter/X profile images, media)
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'pbs.twimg.com',
      },
      {
        protocol: 'https',
        hostname: 'abs.twimg.com',
      },
      {
        protocol: 'https',
        hostname: 'api.twitter.com',
      },
      {
        protocol: 'https',
        hostname: 'twimg.com',
      },
    ],
  },
};

export default nextConfig;
