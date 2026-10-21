'use client';

import type { CriarOrdemRequisicaoDto, OrdemRespostaDto } from '@bolsa/contracts';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { api } from '../api/rest';
import { conectarWs } from '../api/ws';
import type { Sessao } from '../lib/sessao';
import { estadoInicial, reducer } from './reducer';

/**
 * Liga o reducer ao Gateway: WebSocket com reconexão, mercado inicial e a carteira, que
 * é buscada de novo sempre que uma ordem do investidor muda (o saldo não vem por evento,
 * docs/integracao.md §7).
 */
export function usePainel(sessao: Sessao, aoPerderSessao: () => void) {
  const [estado, despachar] = useReducer(reducer, estadoInicial);
  const recarga = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const recarregarCarteira = useCallback(() => {
    clearTimeout(recarga.current);
    // Vários eventos seguidos (um negócio muda duas ordens) viram uma busca só
    recarga.current = setTimeout(() => {
      api
        .carteira(sessao.token)
        .then((carteira) => despachar({ tipo: 'CARTEIRA', carteira }))
        .catch(() => undefined);
    }, 150);
  }, [sessao.token]);

  useEffect(() => {
    api
      .mercado()
      .then((mercado) => despachar({ tipo: 'MERCADO', mercado }))
      .catch(() => undefined);
    const fechar = conectarWs(sessao.token, {
      aoEvento: (evento) => {
        despachar({ tipo: 'EVENTO', evento });
        if (evento.tipo === 'SNAPSHOT' || evento.tipo === 'ORDEM_ATUALIZADA') recarregarCarteira();
      },
      aoMudarConexao: (conectado) => despachar({ tipo: 'CONEXAO', conectado }),
      aoRecusarToken: aoPerderSessao,
    });
    return () => {
      fechar();
      clearTimeout(recarga.current);
    };
  }, [sessao.token, aoPerderSessao, recarregarCarteira]);

  const enviarOrdem = useCallback(
    async (ordem: CriarOrdemRequisicaoDto): Promise<OrdemRespostaDto> => {
      const resposta = await api.enviarOrdem(sessao.token, ordem);
      despachar({ tipo: 'ORDEM_ENVIADA', ordem: resposta });
      recarregarCarteira();
      return resposta;
    },
    [sessao.token, recarregarCarteira],
  );

  return { estado, enviarOrdem };
}
