import type {
  CarteiraRespostaDto,
  HistoricoRespostaDto,
  OrdemResumoDto,
  PosicaoCarteiraDto,
} from '@bolsa/contracts';
import type { Executor } from '../database/database.service';

/**
 * RF-005: saldo, posições, patrimônio e P/L. Toda conta é feita no SQL, sobre NUMERIC
 * (regra 3.3.1). O valor de cada posição usa o preço atual do ativo (último negócio,
 * RF-017) e conta as ações disponíveis e as reservadas em ordens de venda, que continuam
 * sendo do investidor. O preço médio tem 4 casas no banco e sai com 2, como pede o
 * contrato; o P/L usa as 4 casas e só arredonda no fim.
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

  const posicoes = await db.query<PosicaoCarteiraDto>(
    `SELECT a.codigo                                              AS ativo,
            p.quantidade_disponivel                               AS "quantidadeDisponivel",
            p.quantidade_reservada                                AS "quantidadeReservada",
            round(p.preco_medio, 2)::text                         AS "precoMedio",
            a.preco_atual::text                                   AS "precoAtual",
            (a.preco_atual * (p.quantidade_disponivel + p.quantidade_reservada))::text
                                                                  AS "valorAtual",
            round((a.preco_atual - p.preco_medio)
                  * (p.quantidade_disponivel + p.quantidade_reservada), 2)::text
                                                                  AS "lucroPrejuizo"
       FROM posicoes p JOIN ativos a ON a.id = p.ativo_id
      WHERE p.investidor_id = $1
      ORDER BY a.codigo`,
    [investidorId],
  );
  const totais = await db.query<{ patrimonio: string; lucroPrejuizo: string }>(
    `SELECT (i.saldo_disponivel + i.saldo_reservado
             + coalesce(sum(a.preco_atual * (p.quantidade_disponivel + p.quantidade_reservada)), 0)
            )::text AS patrimonio,
            round(coalesce(sum((a.preco_atual - p.preco_medio)
                               * (p.quantidade_disponivel + p.quantidade_reservada)), 0), 2)::text
              AS "lucroPrejuizo"
       FROM investidores i
       LEFT JOIN posicoes p ON p.investidor_id = i.id
       LEFT JOIN ativos a ON a.id = p.ativo_id
      WHERE i.id = $1
      GROUP BY i.id`,
    [investidorId],
  );
  const { patrimonio = saldo.saldoDisponivel, lucroPrejuizo = '0.00' } = totais.rows[0] ?? {};
  return { ...saldo, patrimonio, lucroPrejuizo, posicoes: posicoes.rows };
}

/** Quantas ordens e quantos negócios o histórico devolve (os mais recentes). */
export const LIMITE_HISTORICO = 100;

/**
 * RF-008: ordens do investidor em todas as situações (inclusive REJEITADA e CANCELADA) e
 * os negócios em que ele esteve de um dos lados, do mais novo para o mais antigo. O lado
 * de cada negócio vem da ordem do investidor (o negócio não guarda comprador/vendedor).
 */
export async function buscarHistorico(
  db: Executor,
  investidorId: number,
): Promise<HistoricoRespostaDto> {
  const ordens = await db.query<HistoricoRespostaDto['ordens'][number] & { id: string }>(
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
      WHERE o.investidor_id = $1
      ORDER BY o.id DESC
      LIMIT $2`,
    [investidorId, LIMITE_HISTORICO],
  );
  const negocios = await db.query<
    HistoricoRespostaDto['negocios'][number] & { id: string; ordemId: string }
  >(
    `SELECT n.id,
            o.id                         AS "ordemId",
            a.codigo                     AS ativo,
            upper(o.lado::text)          AS lado,
            n.preco::text                AS preco,
            n.quantidade,
            to_char(n.executado_em, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS momento
       FROM negocios n
       JOIN ordens o ON o.id IN (n.ordem_compra_id, n.ordem_venda_id)
       JOIN ativos a ON a.id = n.ativo_id
      WHERE o.investidor_id = $1
      ORDER BY n.id DESC
      LIMIT $2`,
    [investidorId, LIMITE_HISTORICO],
  );
  return {
    // bigint vem como string do pg; motivoRejeicao só nas REJEITADAS
    ordens: ordens.rows.map(({ motivoRejeicao, ...ordem }) => ({
      ...ordem,
      id: Number(ordem.id),
      ...(motivoRejeicao ? { motivoRejeicao } : {}),
    })),
    negocios: negocios.rows.map((n) => ({ ...n, id: Number(n.id), ordemId: Number(n.ordemId) })),
  };
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
