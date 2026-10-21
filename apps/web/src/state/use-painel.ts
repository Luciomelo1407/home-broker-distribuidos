'use client';

import type { CriarOrdemRequisicaoDto, OrdemRespostaDto } from '@bolsa/contracts';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { api } from '../api/rest';
import { conectarWs } from '../api/ws';
import type { Sessao } from '../lib/sessao';
import { estadoInicial, reducer } from './reducer';

/** Janela das recargas por evento: no máximo uma busca de cada tipo a cada 500 ms. */
export const JANELA_RECARGA_MS = 500;

/**
 * Agenda `buscar` para daqui a `ms`, a menos que já haja uma busca agendada: vários eventos
 * seguidos viram uma busca só, e um fluxo contínuo de eventos ainda gera uma busca por
 * janela (um debounce nunca dispararia sob carga).
 */
function useAgendada(buscar: () => void, ms: number): [() => void, () => void] {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const agendar = useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      buscar();
    }, ms);
  }, [buscar, ms]);
  const cancelar = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  return [agendar, cancelar];
}

/**
 * Liga o reducer ao Gateway: WebSocket com reconexão, mercado inicial, e a carteira e o
 * histórico, que não chegam por evento (docs/integracao.md §7) e são buscados de novo
 * quando algo que os muda acontece.
 */
export function usePainel(sessao: Sessao, aoPerderSessao: () => void) {
  const [estado, despachar] = useReducer(reducer, estadoInicial);

  const buscarCarteira = useCallback(() => {
    api
      .carteira(sessao.token)
      .then((carteira) => despachar({ tipo: 'CARTEIRA', carteira }))
      .catch(() => undefined);
  }, [sessao.token]);
  const buscarHistorico = useCallback(() => {
    api
      .historico(sessao.token)
      .then((historico) => despachar({ tipo: 'HISTORICO', historico }))
      .catch(() => undefined);
  }, [sessao.token]);
  const [recarregarCarteira, pararCarteira] = useAgendada(buscarCarteira, JANELA_RECARGA_MS);
  const [recarregarHistorico, pararHistorico] = useAgendada(buscarHistorico, JANELA_RECARGA_MS);

  useEffect(() => {
    // Na abertura, sem esperar a janela: a tela já começa com carteira e histórico
    buscarCarteira();
    buscarHistorico();
    api
      .mercado()
      .then((mercado) => despachar({ tipo: 'MERCADO', mercado }))
      .catch(() => undefined);
    const fechar = conectarWs(sessao.token, {
      aoEvento: (evento) => {
        despachar({ tipo: 'EVENTO', evento });
        // O patrimônio muda com o preço de qualquer ativo, não só com as próprias ordens
        if (['SNAPSHOT', 'ORDEM_ATUALIZADA', 'PRECO'].includes(evento.tipo)) recarregarCarteira();
        // Só as próprias ordens mudam o histórico do investidor
        if (evento.tipo === 'ORDEM_ATUALIZADA' || evento.tipo === 'SNAPSHOT') recarregarHistorico();
      },
      aoMudarConexao: (conectado) => despachar({ tipo: 'CONEXAO', conectado }),
      aoRecusarToken: aoPerderSessao,
    });
    return () => {
      fechar();
      pararCarteira();
      pararHistorico();
    };
  }, [
    sessao.token,
    aoPerderSessao,
    buscarCarteira,
    buscarHistorico,
    recarregarCarteira,
    recarregarHistorico,
    pararCarteira,
    pararHistorico,
  ]);

  const enviarOrdem = useCallback(
    async (ordem: CriarOrdemRequisicaoDto): Promise<OrdemRespostaDto> => {
      const resposta = await api.enviarOrdem(sessao.token, ordem);
      despachar({ tipo: 'ORDEM_ENVIADA', ordem: resposta });
      recarregarCarteira();
      return resposta;
    },
    [sessao.token, recarregarCarteira],
  );

  const cancelarOrdem = useCallback(
    async (id: number) => {
      const ordem = await api.cancelarOrdem(sessao.token, id);
      despachar({ tipo: 'ORDEM_ENVIADA', ordem });
      recarregarCarteira();
      return ordem;
    },
    [sessao.token, recarregarCarteira],
  );

  return { estado, enviarOrdem, cancelarOrdem };
}
