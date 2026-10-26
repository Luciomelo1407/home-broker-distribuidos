import { verify } from '@node-rs/argon2';
import type { Pool } from 'pg';
import type { AppConfig } from '../config/config.module';
import { DatabaseService } from '../database/database.service';
import { SeedAgentes } from './seed-agentes';

function preparar(falharPosicoes = false) {
  const existentes = new Set<string>();
  const parametrosInseridos: unknown[][] = [];
  const cliente = {
    release: jest.fn(),
    query: jest.fn(async (sql: string, parametros: unknown[] = []) => {
      if (sql.includes('INSERT INTO investidores')) {
        parametrosInseridos.push(parametros);
        const nome = parametros[0] as string;
        if (existentes.has(nome)) return { rows: [] };
        existentes.add(nome);
        return { rows: [{ id: existentes.size }] };
      }
      if (sql.includes('INSERT INTO posicoes') && falharPosicoes)
        throw new Error('posições indisponíveis');
      return { rows: [] };
    }),
  };
  const pool = { connect: async () => cliente } as unknown as Pool;
  const valores: Record<string, unknown> = {
    AGENTES_CONSERVADORES: 2,
    AGENTES_AGRESSIVOS: 1,
    AGENTES_SENHA: 'senha-agentes',
    SALDO_INICIAL: '100000.00',
    ACOES_INICIAIS: 1000,
  };
  const config = { get: (chave: string) => valores[chave] } as unknown as AppConfig;
  return { seed: new SeedAgentes(new DatabaseService(pool), config), cliente, parametrosInseridos };
}

describe('seed dos agentes do auth', () => {
  it('cria os perfis configurados e usa o mesmo Argon2id do login', async () => {
    const { seed, parametrosInseridos, cliente } = preparar();
    await seed.onApplicationBootstrap();
    expect(parametrosInseridos.map(([nome, , perfil, saldo]) => ({ nome, perfil, saldo }))).toEqual(
      [
        { nome: 'agente-conservador-1', perfil: 'conservador', saldo: '100000.00' },
        { nome: 'agente-conservador-2', perfil: 'conservador', saldo: '100000.00' },
        { nome: 'agente-agressivo-1', perfil: 'agressivo', saldo: '100000.00' },
      ],
    );
    for (const [, senhaHash] of parametrosInseridos) {
      expect(senhaHash).toMatch(/^\$argon2id\$/);
      expect(await verify(senhaHash as string, 'senha-agentes')).toBe(true);
    }
    expect(
      cliente.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO posicoes')),
    ).toHaveLength(3);
  });

  it('uma nova subida não redefine contas nem reinsere posições de agentes existentes', async () => {
    const { seed, cliente } = preparar();
    await seed.onApplicationBootstrap();
    cliente.query.mockClear();
    await seed.onApplicationBootstrap();
    expect(cliente.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO posicoes'))).toBe(
      false,
    );
    expect(cliente.query.mock.calls.some(([sql]) => /UPDATE|DELETE/.test(sql))).toBe(false);
    const insercoes = cliente.query.mock.calls.filter(([sql]) =>
      sql.includes('INSERT INTO investidores'),
    );
    expect(insercoes).toHaveLength(3);
    expect(insercoes.every(([sql]) => sql.includes('ON CONFLICT (nome_usuario) DO NOTHING'))).toBe(
      true,
    );
  });

  it('falha ao criar posições faz rollback da criação do agente', async () => {
    const { seed, cliente } = preparar(true);
    await expect(seed.onApplicationBootstrap()).rejects.toThrow('posições indisponíveis');
    expect(cliente.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(cliente.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
    expect(cliente.release).toHaveBeenCalledTimes(1);
  });
});
