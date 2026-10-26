/**
 * Sessão no navegador. O token fica no localStorage para que uma reconexão ou um F5 não
 * peçam login de novo (RF-004). Ele expira sozinho no Gateway (JWT_EXPIRACAO).
 */
export const CHAVE_SESSAO = 'bolsa.sessao';

export interface Sessao {
  token: string;
  investidor: { id: number; nomeUsuario: string };
}

export function lerSessao(): Sessao | undefined {
  try {
    const texto = localStorage.getItem(CHAVE_SESSAO);
    const valor = texto ? (JSON.parse(texto) as Partial<Sessao>) : undefined;
    return valor &&
      typeof valor.token === 'string' &&
      valor.token.length > 0 &&
      Number.isSafeInteger(valor.investidor?.id) &&
      (valor.investidor?.id ?? 0) > 0 &&
      typeof valor.investidor?.nomeUsuario === 'string' &&
      valor.investidor.nomeUsuario.length > 0
      ? (valor as Sessao)
      : undefined;
  } catch {
    return undefined;
  }
}

export function salvarSessao(sessao: Sessao): void {
  localStorage.setItem(CHAVE_SESSAO, JSON.stringify(sessao));
}

export function encerrarSessao(): void {
  try {
    localStorage.removeItem(CHAVE_SESSAO);
  } catch {
    /* Sair também funciona sem armazenamento disponível. */
  }
}
