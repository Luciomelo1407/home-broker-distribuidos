'use client';

import { useState } from 'react';
import type { Sessao } from '../lib/sessao';
import { usePainel } from '../state/use-painel';
import { Carteira } from './carteira';
import { Mercado } from './mercado';
import { Negocios } from './negocios';
import { NovaOrdem } from './nova-ordem';
import { Ordens } from './ordens';

interface Props {
  sessao: Sessao;
  aoSair: () => void;
}

export function Painel({ sessao, aoSair }: Props) {
  const { estado, enviarOrdem } = usePainel(sessao, aoSair);
  const [sugestao, setSugestao] = useState<{ ativo: string; preco: string }>();

  return (
    <div className="painel">
      <header className="topo">
        <h1>Simulador de Bolsa</h1>
        <div className="sessao">
          {/* RNF-11: a queda aparece na tela, e o cliente reconecta sozinho */}
          <span className={`conexao ${estado.conectado ? 'on' : 'off'}`} role="status">
            {estado.conectado ? 'Conectado' : 'Desconectado, reconectando…'}
          </span>
          {estado.conectados !== undefined && (
            <span className="sutil">{estado.conectados} no mercado</span>
          )}
          <span>{sessao.investidor.nomeUsuario}</span>
          <button type="button" className="secundario" onClick={aoSair}>
            Sair
          </button>
        </div>
      </header>
      {estado.erro && (
        <p className="erro faixa" role="alert">
          {estado.erro}
        </p>
      )}
      <main className="grade">
        <div className="coluna">
          <Mercado
            mercado={estado.mercado}
            nomes={estado.nomes}
            aoEscolher={(a) => setSugestao({ ativo: a.ativo, preco: a.precoAtual })}
          />
          <Ordens ordens={estado.ordens} />
        </div>
        <div className="coluna">
          <NovaOrdem
            ativos={estado.mercado.map((a) => a.ativo)}
            sugestao={sugestao}
            enviar={enviarOrdem}
          />
          <Carteira
            saldoDisponivel={estado.saldoDisponivel}
            saldoReservado={estado.saldoReservado}
            posicoes={estado.posicoes}
          />
          <Negocios negocios={estado.negocios} />
        </div>
      </main>
    </div>
  );
}
