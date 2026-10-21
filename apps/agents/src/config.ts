/** Configuração só por variável de ambiente (regra 3.3.9). Sem banco nem Redis (regra 3.3.5). */
export interface ConfigAgentes {
  gatewayUrl: string;
  conservadores: number;
  agressivos: number;
  senha: string;
}

export function lerConfig(ambiente: Record<string, string | undefined>): ConfigAgentes {
  const exigir = (nome: string): string => {
    const valor = ambiente[nome]?.trim();
    if (!valor) throw new Error(`variável de ambiente ${nome} não definida`);
    return valor;
  };
  const inteiro = (nome: string): number => {
    const valor = Number(exigir(nome));
    if (!Number.isInteger(valor) || valor < 0) {
      throw new Error(`variável de ambiente ${nome}: deve ser um inteiro ≥ 0`);
    }
    return valor;
  };
  const gatewayUrl = exigir('GATEWAY_URL').replace(/\/$/, '');
  if (!/^https?:\/\//.test(gatewayUrl)) {
    throw new Error('variável de ambiente GATEWAY_URL: deve ser uma URL http://');
  }
  return {
    gatewayUrl,
    conservadores: inteiro('AGENTES_CONSERVADORES'),
    agressivos: inteiro('AGENTES_AGRESSIVOS'),
    senha: exigir('AGENTES_SENHA'),
  };
}
