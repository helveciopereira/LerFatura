import type { NextConfig } from 'next';

/**
 * Detecta se estamos em ambiente de produção (build/deploy)
 * Em produção, o basePath e assetPrefix são necessários para o GitHub Pages
 * Em desenvolvimento, servimos da raiz (localhost:3000)
 */
const isProd = process.env.NODE_ENV === 'production';
const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**', 
      },
    ],
  },
  output: 'export',
  basePath: isProd ? '/LerFatura' : '',
  assetPrefix: isProd ? '/LerFatura' : '',
  env: {
    NEXT_PUBLIC_BASE_PATH: isProd ? '/LerFatura' : '',
  },
  transpilePackages: ['motion'],
  webpack: (config, { dev }) => {
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

export default nextConfig;
