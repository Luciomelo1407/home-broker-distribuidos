import { afterEach, describe, expect, it, vi } from 'vitest';
import { urlDoGateway, urlDoWebSocket } from './config';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('endereços do Home Broker', () => {
  it('sem configuração fala com o IP da página, permitindo outro computador da LAN', () => {
    vi.stubEnv('NEXT_PUBLIC_GATEWAY_URL', '');
    vi.stubGlobal('window', { location: { protocol: 'http:', hostname: '192.168.1.10' } });
    expect(urlDoGateway()).toBe('http://192.168.1.10:3001');
    expect(urlDoWebSocket('jwt-teste')).toBe('ws://192.168.1.10:3001/ws?token=jwt-teste');
  });

  it('HTTPS conserva transporte seguro no WebSocket', () => {
    vi.stubEnv('NEXT_PUBLIC_GATEWAY_URL', 'https://bolsa.exemplo/gateway/');
    expect(urlDoGateway()).toBe('https://bolsa.exemplo/gateway');
    expect(urlDoWebSocket('a+b/c=')).toBe('wss://bolsa.exemplo/gateway/ws?token=a%2Bb%2Fc%3D');
  });

  it('URL configurada permite porta de Gateway diferente sem apontar para o cliente', () => {
    vi.stubEnv('NEXT_PUBLIC_GATEWAY_URL', 'http://192.168.1.20:4001/');
    expect(urlDoGateway()).toBe('http://192.168.1.20:4001');
  });
});
