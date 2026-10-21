'use client';

import type { CriarOrdemRequisicaoDto, OrdemRespostaDto } from '@bolsa/contracts';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { api, ErroApi } from '../api/rest';
import { LeiturasPainel } from './leituras';
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

  const leituras = useRef<LeiturasPainel | undefined>(undefined);
  const buscarCarteira = useCallback(() => {
    void leituras.current?.carteira();
  }, []);
  const buscarHistorico = useCallback(() => {
    void leituras.current?.historico();
  }, []);
  const [recarregarCarteira, pararCarteira] = useAgendada(buscarCarteira, JANELA_RECARGA_MS);
  const [recarregarHistorico, pararHistorico] = useAgendada(buscarHistorico, JANELA_RECARGA_MS);

  useEffect(() => {
    const atuais = new LeiturasPainel(sessao.token, despachar, aoPerderSessao);
    leituras.current = atuais;
    buscarCarteira();
    buscarHistorico();
    void atuais.mercado();
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
      atuais.cancelar();
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
      const atual = leituras.current;
      let resposta: OrdemRespostaDto;
      try {
        resposta = await api.enviarOrdem(sessao.token, ordem);
      } catch (erro) {
        if (atual?.estaAtiva() && erro instanceof ErroApi && erro.status === 401) aoPerderSessao();
        throw erro;
      }
      if (!atual?.estaAtiva()) return resposta;
      despachar({ tipo: 'ORDEM_ENVIADA', ordem: resposta });
      recarregarCarteira();
      recarregarHistorico();
      return resposta;
    },
    [sessao.token, recarregarCarteira, recarregarHistorico, aoPerderSessao],
  );

  const cancelarOrdem = useCallback(
    async (id: number) => {
      const atual = leituras.current;
      let ordem: OrdemRespostaDto;
      try {
        ordem = await api.cancelarOrdem(sessao.token, id);
      } catch (erro) {
        if (atual?.estaAtiva() && erro instanceof ErroApi && erro.status === 401) aoPerderSessao();
        throw erro;
      }
      if (!atual?.estaAtiva()) return ordem;
      despachar({ tipo: 'ORDEM_ENVIADA', ordem });
      recarregarCarteira();
      recarregarHistorico();
      return ordem;
    },
    [sessao.token, recarregarCarteira, recarregarHistorico, aoPerderSessao],
  );

  const recarregar = () => {
    buscarCarteira();
    buscarHistorico();
    void leituras.current?.mercado();
  };
  const consultarOrdem = async (id: number) => {
    const atual = leituras.current;
    try {
      const ordem = await api.consultarOrdem(sessao.token, id);
      if (atual?.estaAtiva()) {
        despachar({ tipo: 'ORDEM_ENVIADA', ordem });
        recarregarCarteira();
        recarregarHistorico();
      }
      return ordem;
    } catch (erro) {
      if (atual?.estaAtiva() && erro instanceof ErroApi && erro.status === 401) aoPerderSessao();
      throw erro;
    }
  };
  return { estado, enviarOrdem, cancelarOrdem, consultarOrdem, recarregar };
}
