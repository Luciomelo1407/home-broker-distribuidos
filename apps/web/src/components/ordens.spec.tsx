// @vitest-environment jsdom
import type { OrdemRespostaDto } from '@bolsa/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErroApi } from '../api/rest';
import { ordem, pendente } from '../test/apoio';
import { Ordens } from './ordens';

describe('cancelamento na tela', () => {
  it('bloqueia cliques repetidos enquanto o cancelamento está em andamento', async () => {
    const resposta = pendente<unknown>();
    const cancelar = vi.fn().mockReturnValue(resposta.promessa);
    render(<Ordens ordens={[ordem()]} cancelar={cancelar} consultar={vi.fn()} disponivel />);
    const botao = screen.getByRole('button', { name: 'Cancelar' });
    fireEvent.click(botao);
    fireEvent.click(botao);
    expect(cancelar).toHaveBeenCalledTimes(1);
    await act(async () => resposta.resolver(ordem({ status: 'CANCELADA' })));
  });

  it('resultado incerto permite consultar; consulta de ordem aberta não repete DELETE', async () => {
    const cancelar = vi.fn().mockRejectedValue(new ErroApi('NAO_CONFIRMADA', 'timeout', 504));
    const consultar = vi.fn().mockResolvedValue(ordem());
    render(<Ordens ordens={[ordem()]} cancelar={cancelar} consultar={consultar} disponivel />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancelar' })));
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Consultar resultado' })),
    );
    expect(consultar).toHaveBeenCalledWith(7);
    expect(cancelar).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByRole('alert').textContent).toContain('nenhuma solicitação foi repetida');
  });

  it('status terminal consultado resolve a incerteza', async () => {
    const cancelar = vi.fn().mockRejectedValue(new ErroApi('NAO_CONFIRMADA', 'timeout', 504));
    const consultar = vi.fn().mockResolvedValue(ordem({ status: 'CANCELADA' }));
    render(<Ordens ordens={[ordem()]} cancelar={cancelar} consultar={consultar} disponivel />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancelar' })));
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Consultar resultado' })),
    );
    expect(screen.queryByRole('button', { name: 'Consultar resultado' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(cancelar).toHaveBeenCalledTimes(1);
  });

  it.each(['ordem antiga', 'falha tardia'])(
    'evento terminal prevalece sobre consulta com %s',
    async (caso) => {
      const resposta = pendente<OrdemRespostaDto>();
      const cancelar = vi.fn().mockRejectedValue(new ErroApi('NAO_CONFIRMADA', 'timeout', 504));
      const consultar = vi.fn().mockReturnValue(resposta.promessa);
      const { rerender } = render(
        <Ordens ordens={[ordem()]} cancelar={cancelar} consultar={consultar} disponivel />,
      );
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancelar' })));
      fireEvent.click(screen.getByRole('button', { name: 'Consultar resultado' }));
      rerender(
        <Ordens
          ordens={[ordem({ status: 'CANCELADA' })]}
          cancelar={cancelar}
          consultar={consultar}
          disponivel
        />,
      );
      await act(async () => {
        if (caso === 'ordem antiga') resposta.resolver(ordem());
        else resposta.rejeitar(new ErroApi('SEM_CONEXAO', 'rede caiu', 0));
      });
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Consultar resultado' })).toBeNull();
    },
  );

  it('sem sincronização não envia cancelamento', () => {
    const cancelar = vi.fn();
    render(
      <Ordens ordens={[ordem()]} cancelar={cancelar} consultar={vi.fn()} disponivel={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(cancelar).not.toHaveBeenCalled();
  });
});
