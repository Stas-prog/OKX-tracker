import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true, // <-- тимчасово ігнорує всі ESLint помилки при збірці
  },
  webpack(config) {
    config.module.rules.push({
      test: /\.json$/,
      type: 'json'
    })
    return config
  }

};

export default nextConfig;
