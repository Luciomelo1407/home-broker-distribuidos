import type { CarteiraRespostaDto, OrdemResumoDto, PosicaoDto } from '@bolsa/contracts';
import type { Executor } from '../database/database.service';

/**
 * RF-005 (P1): saldo e posições. O preço médio tem 4 casas no banco e sai com 2, como
 * pede o contrato (`PrecoString`). Contas sempre no SQL (regra 3.3.1).
 */
export async function buscarCarteira(
  db: Executor,
  investidorId: number,
): Promise<CarteiraRespostaDto | undefined> {
  const { rows } = await db.query<{ saldoDisponivel: string; saldoReservado: string }>(
    `SELECT saldo_disponivel::text AS "saldoDisponivel", saldo_reservado::text AS "saldoReservado"
       FROM investidores WHERE id = $1`,
    [investidorId],
  );
  const saldo = rows[0];
  if (!saldo) return undefined;

  const posicoes = await db.query<PosicaoDto>(
    `SELECT a.codigo                        AS ativo,
            p.quantidade_disponivel         AS "quantidadeDisponivel",
            p.quantidade_reservada          AS "quantidadeReservada",
            round(p.preco_medio, 2)::text   AS "precoMedio"
       FROM posicoes p JOIN ativos a ON a.id = p.ativo_id
      WHERE p.investidor_id = $1
      ORDER BY a.codigo`,
    [investidorId],
  );
  return { ...saldo, posicoes: posicoes.rows };
}

/** Ordens que ainda estão no livro (ABERTA ou PARCIAL), para o SNAPSHOT (RF-004). */
export async function listarOrdensAbertas(
  db: Executor,
  investidorId: number,
): Promise<OrdemResumoDto[]> {
  const { rows } = await db.query<OrdemResumoDto & { id: string }>(
    `SELECT o.id,
            o.client_order_id::text      AS "clientOrderId",
            a.codigo                     AS ativo,
            upper(o.lado::text)          AS lado,
            o.preco_limite::text         AS "precoLimite",
            o.quantidade,
            o.quantidade_executada       AS "quantidadeExecutada",
            o.status::text               AS status
       FROM ordens o JOIN ativos a ON a.id = o.ativo_id
      WHERE o.investidor_id = $1 AND o.status IN ('ABERTA', 'PARCIAL')
      ORDER BY o.id`,
    [investidorId],
  );
  // ordens.id é bigint, que o pg devolve como string
  return rows.map((linha) => ({ ...linha, id: Number(linha.id) }));
}
