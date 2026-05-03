import type { NextConfig } from 'next';

/**
 * Configuração do Next.js para deploy no Vercel
 * 
 * IMPORTANTE: Não usar output: 'export' no Vercel — ele suporta
 * API Routes server-side nativamente. O basePath também não é necessário
 * pois o Vercel serve da raiz.
 * 
 * Versão: 2.0 (Vercel)
 */
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
  },
  transpilePackages: ['motion'],
};

export default nextConfig;
