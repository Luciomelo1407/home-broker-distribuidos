// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../test/apoio';
import { Livro } from './livro';
import { Mercado } from './mercado';

describe('seleção de ativo e preço', () => {
  it('o ativo tem botão com nome acessível e um clique não dispara seleção duas vezes', () => {
    const aoEscolher = vi.fn();
    const ativo = { ativo: 'ABC3', precoAtual: '25.00', variacao: '0.00', volume: 0 };
    render(
      <Mercado
        mercado={[ativo]}
        nomes={{ ABC3: 'ABC' }}
        selecionado="ABC3"
        aoEscolher={aoEscolher}
      />,
    );
    const botao = screen.getByRole('button', { name: 'Selecionar ABC3', pressed: true });
    expect((botao as HTMLButtonElement).type).toBe('button');
    fireEvent.click(botao);
    expect(aoEscolher).toHaveBeenCalledExactlyOnceWith(ativo);
  });

  it('preço do livro tem botão e preserva o decimal do contrato', () => {
    const escolher = vi.fn();
    render(
      <Livro
        ativo="ABC3"
        livro={{
          ativo: 'ABC3',
          ofertasCompra: [{ preco: '25.00', quantidade: 100 }],
          ofertasVenda: [],
        }}
        aoEscolherPreco={escolher}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Usar preço 25.00 na ordem' }));
    expect(escolher).toHaveBeenCalledExactlyOnceWith('25.00');
  });
});
