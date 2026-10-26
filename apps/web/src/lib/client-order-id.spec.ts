import { afterEach, describe, expect, it, vi } from 'vitest';
import { criarClientOrderId } from './client-order-id';

afterEach(() => vi.unstubAllGlobals());

describe('identificador da ordem no navegador', () => {
  it('usa randomUUID quando disponível', () => {
    const id = '845eb3cd-6ae0-410d-bef7-8839fcb52416';
    vi.stubGlobal('crypto', { randomUUID: () => id });
    expect(criarClientOrderId()).toBe(id);
  });

  it('gera UUID v4 válido e distinto em HTTP sem randomUUID', () => {
    const crypto = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const ids = Array.from({ length: 100 }, criarClientOrderId);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    expect(new Set(ids).size).toBe(100);
  });

  it('ajusta versão e variante mesmo quando os bytes sorteados valem 255', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(255) });
    expect(criarClientOrderId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });
});
