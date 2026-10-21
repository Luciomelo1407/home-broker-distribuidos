import type { EventoMercado, OrdemResumoDto } from '@bolsa/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estadoInicial, LIMITE_NEGOCIOS, reducer, type EstadoTela } from './reducer';

// As mesmas fixtures do T-14: o reducer é testado só com mensagens do contrato
const FIXTURES = join(__dirname, '../../../../packages/contracts/fixtures/validas');
function fixture(nome: string): EventoMercado {
  return JSON.parse(readFileSync(join(FIXTURES, nome), 'utf-8')) as EventoMercado;
}

const evento = (e: EventoMercado): EstadoTela =>
  reducer(estadoInicial, { tipo: 'EVENTO', evento: e });

describe('reducer do Home Broker', () => {
  it('SNAPSHOT substitui saldo, posições, ordens abertas e mercado', () => {
    const snapshot = fixture('evento-snapshot.json');
    const estado = evento(snapshot);

    expect(estado.carregado).toBe(true);
    expect(estado.saldoDisponivel).toBe('100000.00');
    expect(estado.posicoes).toHaveLength(1);
    expect(estado.ordens.map((o) => o.id)).toEqual([1]);
    expect(estado.mercado[0]?.ativo).toBe('PETR4');
  });

  it('ORDEM_ATUALIZADA troca a ordem de mesmo id e põe as novas no topo', () => {
    const atualizada = fixture('evento-ordem-atualizada.json');
    if (atualizada.tipo !== 'ORDEM_ATUALIZADA') throw new Error('fixture errada');
    let estado = reducer(estadoInicial, { tipo: 'EVENTO', evento: atualizada });
    const executada: OrdemResumoDto = {
      ...atualizada.dados,
      quantidadeExecutada: atualizada.dados.quantidade,
      status: 'EXECUTADA',
    };
    estado = reducer(estado, {
      tipo: 'EVENTO',
      evento: { tipo: 'ORDEM_ATUALIZADA', dados: executada },
    });
    estado = reducer(estado, {
      tipo: 'EVENTO',
      evento: { tipo: 'ORDEM_ATUALIZADA', dados: { ...executada, id: 99, status: 'ABERTA' } },
    });

    expect(estado.ordens.map((o) => [o.id, o.status])).toEqual([
      [99, 'ABERTA'],
      [12, 'EXECUTADA'],
    ]);
  });

  it('um SNAPSHOT de reconexão mantém as ordens já encerradas que a tela viu', () => {
    const snapshot = fixture('evento-snapshot.json');
    let estado = reducer(estadoInicial, {
      tipo: 'ORDEM_ENVIADA',
      ordem: { ...(evento(snapshot).ordens[0] as OrdemResumoDto), id: 7, status: 'EXECUTADA' },
    });
    estado = reducer(estado, { tipo: 'EVENTO', evento: snapshot });

    expect(estado.ordens.map((o) => o.id)).toEqual([1, 7]);
  });

  it('NEGOCIO entra no topo, sem repetir e com limite', () => {
    const negocio = fixture('evento-negocio.json');
    if (negocio.tipo !== 'NEGOCIO') throw new Error('fixture errada');
    let estado = estadoInicial;
    for (let id = 1; id <= LIMITE_NEGOCIOS + 5; id++) {
      estado = reducer(estado, {
        tipo: 'EVENTO',
        evento: { tipo: 'NEGOCIO', dados: { ...negocio.dados, id } },
      });
    }
    estado = reducer(estado, {
      tipo: 'EVENTO',
      evento: { tipo: 'NEGOCIO', dados: { ...negocio.dados, id: LIMITE_NEGOCIOS + 5 } },
    });

    expect(estado.negocios).toHaveLength(LIMITE_NEGOCIOS);
    expect(estado.negocios[0]?.id).toBe(LIMITE_NEGOCIOS + 5);
  });

  it('PRECO atualiza só o ativo dele', () => {
    const snapshot = evento(fixture('evento-snapshot.json'));
    const preco = fixture('evento-preco.json');
    if (preco.tipo !== 'PRECO') throw new Error('fixture errada');

    const estado = reducer(snapshot, {
      tipo: 'EVENTO',
      evento: { tipo: 'PRECO', dados: { ...preco.dados, ativo: 'PETR4', precoAtual: '36.00' } },
    });

    expect(estado.mercado).toEqual([{ ...preco.dados, ativo: 'PETR4', precoAtual: '36.00' }]);
  });

  it('PRESENCA, ERRO e CONEXAO', () => {
    let estado = evento(fixture('evento-presenca.json'));
    estado = reducer(estado, { tipo: 'EVENTO', evento: fixture('evento-erro.json') });
    estado = reducer(estado, { tipo: 'CONEXAO', conectado: true });

    expect(estado.conectados).toEqual(expect.any(Number));
    expect(estado.erro).toEqual(expect.any(String));
    expect(estado.conectado).toBe(true);
  });

  it('MERCADO guarda os nomes e só preenche o mercado antes do primeiro SNAPSHOT', () => {
    const mercado = {
      ativos: [
        {
          codigo: 'ABC3',
          nomeEmpresa: 'ABC Tecnologia',
          precoAtual: '25.00',
          precoReferencia: '25.00',
          variacao: '0.00',
          volume: 0,
        },
      ],
    };

    const antes = reducer(estadoInicial, { tipo: 'MERCADO', mercado });
    const depois = reducer(evento(fixture('evento-snapshot.json')), { tipo: 'MERCADO', mercado });

    expect(antes.mercado.map((a) => a.ativo)).toEqual(['ABC3']);
    expect(antes.nomes).toEqual({ ABC3: 'ABC Tecnologia' });
    expect(depois.mercado.map((a) => a.ativo)).toEqual(['PETR4']);
  });
});
