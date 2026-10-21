import type { Executor } from '../database/database.service';

/** Códigos de todos os ativos negociáveis (RF-006). O conjunto é fixo (0002_ativos.sql). */
export async function listarCodigosDeAtivos(db: Executor): Promise<string[]> {
  const { rows } = await db.query<{ codigo: string }>('SELECT codigo FROM ativos ORDER BY codigo');
  return rows.map((linha) => linha.codigo);
}
