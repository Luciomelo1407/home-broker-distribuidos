/**
 * Sessão no navegador. O token fica no localStorage para que uma reconexão ou um F5 não
 * peçam login de novo (RF-004). Ele expira sozinho no Gateway (JWT_EXPIRACAO).
 */
const CHAVE = 'bolsa.sessao';

export interface Sessao {
  token: string;
  investidor: { id: number; nomeUsuario: string };
}

export function lerSessao(): Sessao | undefined {
  try {
    const texto = localStorage.getItem(CHAVE);
    return texto ? (JSON.parse(texto) as Sessao) : undefined;
  } catch {
    return undefined;
  }
}

export function salvarSessao(sessao: Sessao): void {
  localStorage.setItem(CHAVE, JSON.stringify(sessao));
}

export function encerrarSessao(): void {
  localStorage.removeItem(CHAVE);
}
