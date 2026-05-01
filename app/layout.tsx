/**
 * layout.tsx - Layout raiz do LerFatura
 * Define metadados SEO, fontes e estrutura HTML base
 * Versão: 1.0.0
 */

import type { Metadata } from 'next';
import { Space_Grotesk, Inter } from 'next/font/google';
import './globals.css';

// Fonte para títulos e dados monoespaçados
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space-grotesk' });
// Fonte para corpo de texto
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

// Metadados SEO
export const metadata: Metadata = {
  title: 'LerFatura - Leitor de Faturas de Cartão',
  description: 'Leia sua fatura de cartão de crédito em PDF e categorize seus gastos por pessoa. Suporte a faturas do Itaú.',
  keywords: ['fatura', 'cartão de crédito', 'itaú', 'pdf', 'gastos', 'categorização'],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`${spaceGrotesk.variable} ${inter.variable}`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
