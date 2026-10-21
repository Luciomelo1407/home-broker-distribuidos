// @vitest-environment jsdom
import type { CriarOrdemRequisicaoDto, OrdemRespostaDto } from '@bolsa/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErroApi } from '../api/rest';
import { ordem, pendente } from '../test/apoio';
import { NovaOrdem } from './nova-ordem';

const props = { ativos: ['ABC3', 'DEF4'], ordens: [], disponivel: true, investidorId: 1 };
function preencher() {
  fireEvent.change(screen.getByLabelText('Preço limite (R$)'), { target: { value: '25,00' } });
}

describe('formulário de nova ordem', () => {
  it('bloqueia clique repetido e edição enquanto espera a resposta', async () => {
    const resposta = pendente<OrdemRespostaDto>();
    const enviar = vi.fn().mockReturnValue(resposta.promessa);
    render(<NovaOrdem {...props} enviar={enviar} />);
    preencher();
    const botao = screen.getByRole('button', { name: 'Enviar compra' });
    fireEvent.click(botao);
    fireEvent.click(botao);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('Quantidade') as HTMLInputElement).disabled).toBe(true);
    await act(async () => resposta.resolver(ordem()));
  });

  it('timeout preserva o corpo inteiro; repetir é uma ação manual com o mesmo UUID', async () => {
    const enviar = vi
      .fn<(corpo: CriarOrdemRequisicaoDto) => Promise<OrdemRespostaDto>>()
      .mockRejectedValueOnce(new ErroApi('NAO_CONFIRMADA', 'aguarde', 504))
      .mockImplementationOnce(async (corpo) => ordem({ clientOrderId: corpo.clientOrderId }));
    const { rerender } = render(<NovaOrdem {...props} enviar={enviar} />);
    preencher();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Enviar compra' })));
    rerender(<NovaOrdem {...props} enviar={enviar} sugestao={{ ativo: 'DEF4', preco: '99.00' }} />);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('Preço limite (R$)') as HTMLInputElement).disabled).toBe(true);
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Repetir a mesma solicitação' })),
    );
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(enviar.mock.calls[1]?.[0]).toEqual(enviar.mock.calls[0]?.[0]);
    expect(sessionStorage.getItem('bolsa.tentativa.1')).toBeNull();
  });

  it('F5 restaura a intenção; outra conta não a reutiliza', async () => {
    const corpo: CriarOrdemRequisicaoDto = {
      clientOrderId: ordem().clientOrderId,
      ativo: 'ABC3',
      lado: 'VENDA',
      quantidade: 12,
      preco: '26.00',
    };
    sessionStorage.setItem('bolsa.tentativa.1', JSON.stringify(corpo));
    const enviar = vi.fn().mockResolvedValue(ordem());
    const { unmount } = render(<NovaOrdem {...props} enviar={enviar} investidorId={2} />);
    expect(screen.queryByRole('button', { name: 'Repetir a mesma solicitação' })).toBeNull();
    unmount();
    render(<NovaOrdem {...props} enviar={enviar} />);
    expect((screen.getByLabelText('Quantidade') as HTMLInputElement).value).toBe('12');
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Repetir a mesma solicitação' })),
    );
    expect(enviar).toHaveBeenCalledWith(corpo);
  });

  it('confirmação por evento prevalece sobre timeout posterior da mesma chamada', async () => {
    const resposta = pendente<OrdemRespostaDto>();
    const enviar = vi
      .fn<(corpo: CriarOrdemRequisicaoDto) => Promise<OrdemRespostaDto>>()
      .mockReturnValue(resposta.promessa);
    const { rerender } = render(<NovaOrdem {...props} enviar={enviar} />);
    preencher();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar compra' }));
    const enviada = enviar.mock.calls[0]?.[0];
    rerender(
      <NovaOrdem
        {...props}
        enviar={enviar}
        ordens={[ordem({ clientOrderId: enviada?.clientOrderId })]}
      />,
    );
    await act(async () => resposta.rejeitar(new ErroApi('NAO_CONFIRMADA', 'timeout', 504)));
    expect(screen.getByText(/Resultado confirmado: ordem #7 aberta/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Repetir a mesma solicitação' })).toBeNull();
  });

  it('mercado indisponível bloqueia envio, inclusive submit pelo formulário', () => {
    const enviar = vi.fn();
    render(<NovaOrdem {...props} enviar={enviar} disponivel={false} />);
    const botao = screen.getByRole('button', { name: 'Enviar compra' }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    fireEvent.submit(botao.closest('form')!);
    expect(enviar).not.toHaveBeenCalled();
  });

  it('recusa definitiva libera os campos e uma nova intenção recebe outro UUID', async () => {
    const enviar = vi
      .fn<(corpo: CriarOrdemRequisicaoDto) => Promise<OrdemRespostaDto>>()
      .mockRejectedValueOnce(new ErroApi('VALIDACAO', 'preço inválido', 400))
      .mockImplementationOnce(async (corpo) => ordem({ clientOrderId: corpo.clientOrderId }));
    render(<NovaOrdem {...props} enviar={enviar} />);
    preencher();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Enviar compra' })));
    expect((screen.getByLabelText('Quantidade') as HTMLInputElement).disabled).toBe(false);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Enviar compra' })));
    expect(enviar.mock.calls[0]?.[0].clientOrderId).not.toBe(
      enviar.mock.calls[1]?.[0].clientOrderId,
    );
  });
});
