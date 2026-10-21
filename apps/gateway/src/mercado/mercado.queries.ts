import type { Executor } from '../database/database.service';

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
