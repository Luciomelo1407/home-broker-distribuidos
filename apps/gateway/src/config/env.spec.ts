import { validarEnv } from './env';

const envValido = {
  GATEWAY_DATABASE_URL: 'postgres://gateway_app:gateway_dev@localhost:5432/bolsa',
  REDIS_URL: 'redis://localhost:6379',
  GATEWAY_PORT: '3001',
  JWT_SECRET: 'troque-este-segredo-em-producao',
  LOG_LEVEL: 'info',
  JWT_EXPIRACAO: '8h',
  ORDEM_TIMEOUT_MS: '3000',
  SALDO_INICIAL: '100000.00',
  ACOES_INICIAIS: '1000',
  AGENTES_CONSERVADORES: '3',
  AGENTES_AGRESSIVOS: '2',
  AGENTES_SENHA: 'senha-dos-agentes',
};

describe('validarEnv', () => {
  it('aceita o .env.example e converte os números', () => {
    const env = validarEnv(envValido);

    expect(env.GATEWAY_PORT).toBe(3001);
    expect(env.ORDEM_TIMEOUT_MS).toBe(3000);
    expect(env.ACOES_INICIAIS).toBe(1000);
    // dinheiro continua string (regra 3.3.1)
    expect(env.SALDO_INICIAL).toBe('100000.00');
  });

  it('falha listando a variável que falta', () => {
    const semSegredo: Record<string, string> = { ...envValido };
    delete semSegredo.JWT_SECRET;

    expect(() => validarEnv(semSegredo)).toThrow(/JWT_SECRET/);
  });

  it.each([
    ['GATEWAY_PORT', 'abc'],
    ['GATEWAY_PORT', ''],
    ['ORDEM_TIMEOUT_MS', '0'],
    ['ACOES_INICIAIS', ''],
    ['ACOES_INICIAIS', '1.5'],
    ['SALDO_INICIAL', '100.123'],
    ['SALDO_INICIAL', '-1'],
    ['GATEWAY_DATABASE_URL', 'mysql://x'],
    ['JWT_SECRET', 'curto'],
    ['LOG_LEVEL', 'verbose'],
    ['AGENTES_CONSERVADORES', '-1'],
    ['AGENTES_SENHA', '123'],
  ])('recusa %s = %j', (nome, valor) => {
    expect(() => validarEnv({ ...envValido, [nome]: valor })).toThrow(nome);
  });

  it('não coloca o valor das variáveis na mensagem de erro', () => {
    const segredo = 'segredo-curto';

    expect(() => validarEnv({ ...envValido, JWT_SECRET: segredo })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(segredo) }),
    );
  });
});
