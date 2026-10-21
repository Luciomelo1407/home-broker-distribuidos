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
    socket.onopen = () => ouvintes.aoMudarConexao(true);
    socket.onmessage = (mensagem) => {
      try {
        ouvintes.aoEvento(JSON.parse(String(mensagem.data)) as EventoMercado);
      } catch {
        // Mensagem fora do contrato: ignorada, a próxima pode estar certa
      }
    };
    socket.onclose = (fechamento) => {
      ouvintes.aoMudarConexao(false);
      if (encerrado) return;
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
