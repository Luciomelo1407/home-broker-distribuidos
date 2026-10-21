import type { EventoMercado } from '@bolsa/contracts';
import { urlDoWebSocket } from './config';

/** RNF-11: nova tentativa a cada ≤ 5 s depois de perder a conexão. */
export const INTERVALO_RECONEXAO_MS = 2_000;
/** Código com que o Gateway recusa token inválido (docs/integracao.md §5). */
const FECHAMENTO_NAO_AUTENTICADO = 4401;

export interface OuvintesWs {
  aoEvento: (evento: EventoMercado) => void;
  aoMudarConexao: (conectado: boolean) => void;
  /** Token recusado: não adianta reconectar, precisa de login. */
  aoRecusarToken: () => void;
}

/**
 * Cliente WebSocket que reconecta sozinho. Cada reconexão recebe um SNAPSHOT novo, então
 * nenhum evento perdido durante a queda deixa a tela errada (RF-004).
 * Devolve a função que fecha de vez.
 */
export function conectarWs(token: string, ouvintes: OuvintesWs): () => void {
  let socket: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let encerrado = false;

  const abrir = () => {
    socket = new WebSocket(urlDoWebSocket(token));
    // Conexão aberta ainda não significa estado recuperado: aguarda o SNAPSHOT.
    socket.onopen = () => {
      if (!encerrado) ouvintes.aoMudarConexao(false);
    };
    socket.onmessage = (mensagem) => {
      if (encerrado) return;
      try {
        const evento = JSON.parse(String(mensagem.data)) as EventoMercado;
        ouvintes.aoEvento(evento);
        if (evento.tipo === 'SNAPSHOT') ouvintes.aoMudarConexao(true);
      } catch {
        // Mensagem fora do contrato: ignorada, a próxima pode estar certa
      }
    };
    socket.onclose = (fechamento) => {
      if (encerrado) return;
      ouvintes.aoMudarConexao(false);
      if (fechamento.code === FECHAMENTO_NAO_AUTENTICADO) {
        ouvintes.aoRecusarToken();
        return;
      }
      timer = setTimeout(abrir, INTERVALO_RECONEXAO_MS);
    };
  };

  abrir();
  return () => {
    encerrado = true;
    clearTimeout(timer);
    socket?.close();
  };
}
