import type { Executor } from '../database/database.service';

export interface LinhaLogin {
  id: number;
  senhaHash: string;
}

/**
 * RF-001: cria o investidor com o saldo inicial (S-01). Só as colunas que o
 * `gateway_app` pode inserir (0003_grants.sql).
 */
export async function inserirInvestidor(
  db: Executor,
  nomeUsuario: string,
  senhaHash: string,
  saldoInicial: string,
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO investidores (nome_usuario, senha_hash, saldo_disponivel)
     VALUES ($1, $2, $3) RETURNING id`,
    [nomeUsuario, senhaHash, saldoInicial],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('INSERT de investidor não devolveu o id');
  return id;
}

/** S-01: a mesma quantidade inicial de cada ativo para o investidor novo. */
export async function inserirPosicoesIniciais(
  db: Executor,
  investidorId: number,
  quantidade: number,
): Promise<void> {
  await db.query(
    `INSERT INTO posicoes (investidor_id, ativo_id, quantidade_disponivel)
     SELECT $1, id, $2 FROM ativos`,
    [investidorId, quantidade],
  );
}

export async function buscarParaLogin(
  db: Executor,
  nomeUsuario: string,
): Promise<LinhaLogin | undefined> {
  const { rows } = await db.query<LinhaLogin>(
    'SELECT id, senha_hash AS "senhaHash" FROM investidores WHERE nome_usuario = $1',
    [nomeUsuario],
  );
  return rows[0];
}

/**
 * Investidor-agente (RF-019, AP-05). `undefined` se o nome já existe: o seed roda a cada
 * subida e não mexe em quem já negociou.
 */
export async function inserirAgente(
  db: Executor,
  agente: { nomeUsuario: string; senhaHash: string; perfil: string; saldoInicial: string },
): Promise<number | undefined> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO investidores (nome_usuario, senha_hash, tipo, perfil, saldo_disponivel)
     VALUES ($1, $2, 'agente', $3::perfil_agente, $4)
     ON CONFLICT (nome_usuario) DO NOTHING
     RETURNING id`,
    [agente.nomeUsuario, agente.senhaHash, agente.perfil, agente.saldoInicial],
  );
  return rows[0]?.id;
}
