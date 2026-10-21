'use client';

import { useState } from 'react';
import type { Sessao } from '../lib/sessao';
import { usePainel } from '../state/use-painel';
import { Carteira } from './carteira';
import { Historico } from './historico';
import { Livro } from './livro';
import { Mercado } from './mercado';
import { Negocios } from './negocios';
import { NovaOrdem } from './nova-ordem';
import { Ordens } from './ordens';

interface Props {
  sessao: Sessao;
  aoSair: () => void;
}

export function Painel({ sessao, aoSair }: Props) {
  const { estado, enviarOrdem, cancelarOrdem, consultarOrdem, recarregar } = usePainel(
    sessao,
    aoSair,
  );
  const [sugestao, setSugestao] = useState<{ ativo: string; preco: string }>();
  const [selecionado, setSelecionado] = useState<string>();
  const ativo = selecionado ?? estado.mercado[0]?.ativo;
  const disponivel = estado.conectado && estado.carregado && estado.mercadoDisponivel;

  return (
    <div className="painel">
      <header className="topo">
        <h1>Simulador de Bolsa</h1>
        <div className="sessao">
          {/* RNF-11: a queda aparece na tela, e o cliente reconecta sozinho */}
          <span className={`conexao ${estado.conectado ? 'on' : 'off'}`} role="status">
            {estado.conectado && estado.carregado
              ? 'Conectado e sincronizado'
              : 'Desconectado ou sincronizando…'}
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
      {!disponivel && (
        <p className="sutil faixa" role="status">
          As informações podem estar desatualizadas. Novas operações estão pausadas até a
          sincronização e a volta do mercado.
        </p>
      )}
      {Object.values(estado.falhasLeitura).some(Boolean) && (
        <div className="erro faixa" role="alert">
          {Object.entries(estado.falhasLeitura)
            .filter(([, mensagem]) => mensagem)
            .map(([fonte, mensagem]) => (
              <p key={fonte}>
                Falha ao atualizar {fonte}: {mensagem}
              </p>
            ))}
          <button type="button" className="secundario" onClick={recarregar}>
            Atualizar dados
          </button>
        </div>
      )}
      <main className="grade">
        <div className="coluna">
          <Mercado
            mercado={estado.mercado}
            nomes={estado.nomes}
            selecionado={ativo}
            aoEscolher={(a) => {
              setSelecionado(a.ativo);
              setSugestao({ ativo: a.ativo, preco: a.precoAtual });
            }}
          />
          {ativo && (
            <Livro
              ativo={ativo}
              livro={estado.livros[ativo]}
              aoEscolherPreco={(preco) => setSugestao({ ativo, preco })}
            />
          )}
          <Ordens
            ordens={estado.ordens}
            cancelar={cancelarOrdem}
            consultar={consultarOrdem}
            disponivel={disponivel}
          />
          <Historico negocios={estado.meusNegocios} />
        </div>
        <div className="coluna">
          <NovaOrdem
            ativos={estado.mercado.map((a) => a.ativo)}
            sugestao={sugestao}
            enviar={enviarOrdem}
            ordens={estado.ordens}
            disponivel={disponivel}
            investidorId={sessao.investidor.id}
          />
          {!estado.carregado && !estado.patrimonio ? (
            <section className="cartao">
              <h2>Carteira</h2>
              <p className="sutil">Carregando dados do investidor…</p>
            </section>
          ) : (
            <Carteira
              saldoDisponivel={estado.saldoDisponivel}
              saldoReservado={estado.saldoReservado}
              posicoes={estado.posicoes}
              patrimonio={estado.patrimonio}
            />
          )}
          <Negocios negocios={estado.negocios} />
        </div>
      </main>
    </div>
  );
}
