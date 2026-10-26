// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAVE_SESSAO, salvarSessao, type Sessao } from '../../lib/sessao';
import '../../test/apoio';
import PaginaPainel from './page';

const { router } = vi.hoisted(() => ({ router: { replace: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('../../components/painel', () => ({
  Painel: ({ sessao, aoSair }: { sessao: Sessao; aoSair: () => void }) => {
    const [rascunho, setRascunho] = useState('');
    return (
      <div>
        <span>{sessao.investidor.nomeUsuario}</span>
        <input
          aria-label="Rascunho privado"
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
        />
        <button onClick={aoSair}>Sair</button>
      </div>
    );
  },
}));
const ana = { token: 'token-ana', investidor: { id: 1, nomeUsuario: 'ana' } };
beforeEach(() => router.replace.mockClear());

describe('sessão da página do painel', () => {
  it('sem sessão redireciona ao login sem renderizar dados privados', () => {
    render(<PaginaPainel />);
    expect(router.replace).toHaveBeenCalledWith('/login/');
    expect(screen.queryByRole('button', { name: 'Sair' })).toBeNull();
  });

  it('logout em outra aba remove imediatamente os dados privados', () => {
    salvarSessao(ana);
    render(<PaginaPainel />);
    expect(screen.getByText('ana')).toBeTruthy();
    localStorage.removeItem(CHAVE_SESSAO);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: CHAVE_SESSAO }));
    });
    expect(screen.queryByText('ana')).toBeNull();
    expect(router.replace).toHaveBeenCalledWith('/login/');
  });

  it('troca de conta reinicia o estado privado do painel anterior', () => {
    salvarSessao(ana);
    render(<PaginaPainel />);
    fireEvent.change(screen.getByLabelText('Rascunho privado'), {
      target: { value: 'intenção da ana' },
    });
    salvarSessao({ token: 'token-bruno', investidor: { id: 2, nomeUsuario: 'bruno' } });
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: CHAVE_SESSAO }));
    });
    expect(screen.queryByText('ana')).toBeNull();
    expect(screen.getByText('bruno')).toBeTruthy();
    expect((screen.getByLabelText('Rascunho privado') as HTMLInputElement).value).toBe('');
  });

  it('botão Sair limpa armazenamento e painel no mesmo fluxo', () => {
    salvarSessao(ana);
    render(<PaginaPainel />);
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(localStorage.getItem(CHAVE_SESSAO)).toBeNull();
    expect(screen.queryByText('ana')).toBeNull();
  });
});
