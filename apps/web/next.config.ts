import type { NextConfig } from 'next';

// Regra 3.3.4 da arquitetura: o Home Broker é só cliente. Exportação estática,
// sem app/api/ e sem Server Actions.
const nextConfig: NextConfig = {
  output: 'export',
};

export default nextConfig;
