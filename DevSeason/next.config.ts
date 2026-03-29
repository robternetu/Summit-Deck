import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: [],
  },
  images: {
    // Allow unoptimized images for local logo files
    unoptimized: true,
  },
}

export default nextConfig
