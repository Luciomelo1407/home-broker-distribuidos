/**
 * Endereço do Gateway. Sem NEXT_PUBLIC_GATEWAY_URL, usa o mesmo host da página na porta
 * 3001: assim o Home Broker aberto de outra máquina (CA-01) fala com o Gateway da
 * máquina da demo sem precisar recompilar.
 */
export function urlDoGateway(): string {
  const configurada = process.env.NEXT_PUBLIC_GATEWAY_URL;
  if (configurada) return configurada.replace(/\/$/, '');
  return `${window.location.protocol}//${window.location.hostname}:3001`;
}

export function urlDoWebSocket(token: string): string {
  return `${urlDoGateway().replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;
}
