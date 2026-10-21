import type { OrdemRespostaDto } from '@bolsa/contracts';
import type { Executor } from '../database/database.service';

/** Códigos de todos os ativos negociáveis (RF-006). O conjunto é fixo (0002_ativos.sql). */
export async function listarCodigosDeAtivos(db: Executor): Promise<string[]> {
  const { rows } = await db.query<{ codigo: string }>('SELECT codigo FROM ativos ORDER BY codigo');
  return rows.map((linha) => linha.codigo);
}

/** Uma ordem pelo id, com o dono (RF-011). `undefined` se não existe. */
export async function buscarOrdem(db: Executor, id: number): Promise<OrdemRespostaDto | undefined> {
  const { rows } = await db.query<OrdemRespostaDto & { id: string }>(
    `SELECT o.id,
            o.client_order_id::text      AS "clientOrderId",
            o.investidor_id              AS "investidorId",
            a.codigo                     AS ativo,
            upper(o.lado::text)          AS lado,
            o.preco_limite::text         AS "precoLimite",
            o.quantidade,
            o.quantidade_executada       AS "quantidadeExecutada",
            o.status::text               AS status,
            o.motivo_rejeicao            AS "motivoRejeicao"
       FROM ordens o JOIN ativos a ON a.id = o.ativo_id
      WHERE o.id = $1`,
    [id],
  );
  const linha = rows[0];
  if (!linha) return undefined;
  // ordens.id é bigint (string no pg); motivoRejeicao só existe nas REJEITADAS
  const { motivoRejeicao, ...resto } = linha;
  return { ...resto, id: Number(linha.id), ...(motivoRejeicao ? { motivoRejeicao } : {}) };
}
