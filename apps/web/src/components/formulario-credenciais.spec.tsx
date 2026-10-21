// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ErroApi } from '../api/rest';
import { CHAVE_SESSAO } from '../lib/sessao';
import { pendente } from '../test/apoio';
import { FormularioCredenciais } from './formulario-credenciais';

const { router } = vi.hoisted(() => ({ router: { replace: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const sessao = { token: 'token-ana', investidor: { id: 1, nomeUsuario: 'ana' } };
beforeEach(() => router.replace.mockClear());

function preencher() {
  fireEvent.change(screen.getByLabelText('Usuário'), { target: { value: 'ana' } });
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha-123' } });
}

describe('formulário de acesso', () => {
  it('salva o login e navega para o painel somente após sucesso', async () => {
    vi.spyOn(api, 'entrar').mockResolvedValue(sessao);
    render(<FormularioCredenciais modo="login" />);
    preencher();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Entrar' })));
    expect(JSON.parse(localStorage.getItem(CHAVE_SESSAO) ?? 'null')).toEqual(sessao);
    expect(router.replace).toHaveBeenCalledWith('/painel/');
  });

  it('cliques seguidos não duplicam cadastro nem login', async () => {
    const resposta = pendente<{ id: number; nomeUsuario: string; saldoDisponivel: string }>();
    const cadastrar = vi.spyOn(api, 'cadastrar').mockReturnValue(resposta.promessa);
    const entrar = vi.spyOn(api, 'entrar').mockResolvedValue(sessao);
    render(<FormularioCredenciais modo="cadastro" />);
    preencher();
    const botao = screen.getByRole('button', { name: 'Criar conta' });
    fireEvent.click(botao);
    fireEvent.click(botao);
    expect(cadastrar).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('Senha') as HTMLInputElement).disabled).toBe(true);
    await act(async () =>
      resposta.resolver({ id: 1, nomeUsuario: 'ana', saldoDisponivel: '100000.00' }),
    );
    expect(entrar).toHaveBeenCalledTimes(1);
  });

  it('cadastro confirmado com login indisponível repete apenas o login', async () => {
    const cadastrar = vi.spyOn(api, 'cadastrar').mockResolvedValue({
      id: 1,
      nomeUsuario: 'ana',
      saldoDisponivel: '100000.00',
    });
    const entrar = vi
      .spyOn(api, 'entrar')
      .mockRejectedValueOnce(new ErroApi('SEM_CONEXAO', 'servidor indisponível', 0))
      .mockResolvedValueOnce(sessao);
    render(<FormularioCredenciais modo="cadastro" />);
    preencher();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Criar conta' })));
    expect(screen.getByRole('alert').textContent).toBe('servidor indisponível');
    expect((screen.getByLabelText('Usuário') as HTMLInputElement).disabled).toBe(true);
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Entrar na conta criada' })),
    );
    expect(cadastrar).toHaveBeenCalledTimes(1);
    expect(entrar).toHaveBeenCalledTimes(2);
    expect(router.replace).toHaveBeenCalledWith('/painel/');
  });

  it('resposta atrasada após sair da página não restaura uma sessão', async () => {
    const resposta = pendente<typeof sessao>();
    vi.spyOn(api, 'entrar').mockReturnValue(resposta.promessa);
    const { unmount } = render(<FormularioCredenciais modo="login" />);
    preencher();
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    unmount();
    await act(async () => resposta.resolver(sessao));
    expect(localStorage.getItem(CHAVE_SESSAO)).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('senha incorreta mostra a recusa e mantém o usuário fora do painel', async () => {
    vi.spyOn(api, 'entrar').mockRejectedValue(
      new ErroApi('CREDENCIAIS_INVALIDAS', 'credenciais inválidas', 401),
    );
    render(<FormularioCredenciais modo="login" />);
    preencher();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Entrar' })));
    expect(screen.getByRole('alert').textContent).toBe('credenciais inválidas');
    expect(localStorage.getItem(CHAVE_SESSAO)).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
