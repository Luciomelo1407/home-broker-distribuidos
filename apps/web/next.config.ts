import type { NextConfig } from 'next';

// Regra 3.3.4 da arquitetura: o Home Broker é só cliente. Exportação estática,
// sem app/api/ e sem Server Actions.
const nextConfig: NextConfig = {
  output: 'export',
  // /painel/ vira out/painel/index.html: qualquer servidor estático entrega sem regra extra
  trailingSlash: true,
  // packages/contracts é TypeScript sem build próprio
  transpilePackages: ['@bolsa/contracts'],
};

export default nextConfig;
