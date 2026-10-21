import type { OrdemRespostaDto } from '@bolsa/contracts';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

export function pendente<T>() {
  let resolver!: (valor: T) => void;
  let rejeitar!: (erro: unknown) => void;
  const promessa = new Promise<T>((resolve, reject) => {
    resolver = resolve;
    rejeitar = reject;
  });
  return { promessa, resolver, rejeitar };
}

export function ordem(alteracoes: Partial<OrdemRespostaDto> = {}): OrdemRespostaDto {
  return {
    id: 7,
    clientOrderId: '439a34b9-842c-4538-b927-fb29533bc723',
    investidorId: 1,
    ativo: 'ABC3',
    lado: 'COMPRA',
    precoLimite: '25.00',
    quantidade: 100,
    quantidadeExecutada: 0,
    status: 'ABERTA',
    ...alteracoes,
  };
}
