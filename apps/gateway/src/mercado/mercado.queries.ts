import type { EventoMercado } from '@bolsa/contracts';
import type { Executor } from '../database/database.service';

/** Mesmo formato de `LIVRO.dados` no WebSocket e de `GET /mercado/livro/:ativo`. */
export type LivroDto = Extract<EventoMercado, { tipo: 'LIVRO' }>['dados'];

export interface LinhaAtivo {
  codigo: string;
  nomeEmpresa: string;
  precoAtual: string;
  precoReferencia: string;
  variacao: string;
  volume: string;
}

/**
 * Estado atual de todos os ativos (RF-006). A variação % é calculada no SQL, sobre
 * NUMERIC, e sai como texto com 2 casas (regra 3.3.1: dinheiro e % nunca em float).
 * `volume` é bigint e chega como string do `pg`.
 */
export async function listarAtivos(db: Executor): Promise<LinhaAtivo[]> {
  const { rows } = await db.query<LinhaAtivo>(
    `SELECT codigo,
            nome_empresa                AS "nomeEmpresa",
            preco_atual::text           AS "precoAtual",
            preco_referencia::text      AS "precoReferencia",
            round((preco_atual - preco_referencia) * 100 / preco_referencia, 2)::text AS variacao,
            volume_negociado::text      AS volume
       FROM ativos
      ORDER BY codigo`,
  );
  return rows;
}

/** Níveis de preço mostrados por lado (RF-007: pelo menos os 5 melhores). */
export const NIVEIS_DO_LIVRO = 5;

/**
 * RF-007: livro agregado por preço, só com o que falta executar das ordens ABERTA/PARCIAL.
 * Compra do maior para o menor preço, venda do menor para o maior (melhor oferta primeiro).
 */
export async function buscarLivro(db: Executor, codigo: string): Promise<LivroDto> {
  const { rows } = await db.query<{ lado: 'compra' | 'venda'; preco: string; quantidade: string }>(
    `WITH niveis AS (
       SELECT o.lado, o.preco_limite AS preco,
              sum(o.quantidade - o.quantidade_executada) AS quantidade,
              row_number() OVER (
                PARTITION BY o.lado
                ORDER BY CASE WHEN o.lado = 'compra' THEN -o.preco_limite ELSE o.preco_limite END
              ) AS posicao
         FROM ordens o JOIN ativos a ON a.id = o.ativo_id
        WHERE a.codigo = $1 AND o.status IN ('ABERTA', 'PARCIAL')
        GROUP BY o.lado, o.preco_limite
     )
     SELECT lado::text AS lado, preco::text AS preco, quantidade::text AS quantidade
       FROM niveis WHERE posicao <= $2
      ORDER BY lado, posicao`,
    [codigo, NIVEIS_DO_LIVRO],
  );
  const lado = (l: 'compra' | 'venda') =>
    rows
      .filter((linha) => linha.lado === l)
      .map((linha) => ({ preco: linha.preco, quantidade: Number(linha.quantidade) }));
  return { ativo: codigo, ofertasCompra: lado('compra'), ofertasVenda: lado('venda') };
}
