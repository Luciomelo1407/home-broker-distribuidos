import { JwtService } from '@nestjs/jwt';
import { hash } from '@node-rs/argon2';
import type { AppConfig } from '../config/config.module';
import type { DatabaseService } from '../database/database.service';
import { AuthService } from './auth.service';

const secret = 'segredo-exclusivo-dos-testes-unitarios';
const jwt = new JwtService({
  secret,
  signOptions: { algorithm: 'HS256', expiresIn: '1h' },
  verifyOptions: { algorithms: ['HS256'] },
});
const config = {
  get: (chave: string) => (chave === 'SALDO_INICIAL' ? '100000.00' : 1000),
} as unknown as AppConfig;

describe('AuthService', () => {
  it('login com senha correta usa Argon2 e emite JWT com a identidade do banco', async () => {
    const senhaHash = await hash('senha-do-teste');
    const db = {
      query: async () => ({ rows: [{ id: 7, senhaHash }] }),
    } as unknown as DatabaseService;
    const auth = new AuthService(db, jwt, config);
    await auth.onModuleInit();
    const login = await auth.entrar({ nomeUsuario: 'ana', senha: 'senha-do-teste' });
    expect(await auth.verificar(login.token)).toEqual({ id: 7 });
  });
  it('usuário inexistente e senha errada devolvem a mesma recusa', async () => {
    const senhaHash = await hash('senha-do-teste');
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 7, senhaHash }] });
    const auth = new AuthService({ query } as unknown as DatabaseService, jwt, config);
    await auth.onModuleInit();
    for (let i = 0; i < 2; i++)
      await expect(auth.entrar({ nomeUsuario: 'ana', senha: 'incorreta' })).rejects.toMatchObject({
        codigo: 'CREDENCIAIS_INVALIDAS',
        httpStatus: 401,
      });
  });
  it.each([0, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1])(
    'recusa identidade inválida %s mesmo com assinatura válida',
    async (sub) => {
      const auth = new AuthService({} as DatabaseService, jwt, config);
      expect(await auth.verificar(await jwt.signAsync({ sub }))).toBeUndefined();
    },
  );
  it('recusa token expirado e token assinado por outra chave', async () => {
    const auth = new AuthService({} as DatabaseService, jwt, config);
    expect(
      await auth.verificar(await jwt.signAsync({ sub: 7 }, { expiresIn: -1 })),
    ).toBeUndefined();
    expect(
      await auth.verificar(await new JwtService({ secret: 'outra-chave' }).signAsync({ sub: 7 })),
    ).toBeUndefined();
  });
});
