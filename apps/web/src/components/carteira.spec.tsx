// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../test/apoio';
import { Carteira } from './carteira';

describe('componente Carteira', () => {
  it('exibe saldos, patrimônio e P/L com cores e formatação com sinal', () => {
    render(
      <Carteira
        saldoDisponivel="85000.00"
        saldoReservado="15000.00"
        posicoes={[
          {
            ativo: 'PETR4',
            quantidadeDisponivel: 100,
            quantidadeReservada: 0,
            precoMedio: '30.00',
          },
          {
            ativo: 'VALE3',
            quantidadeDisponivel: 50,
            quantidadeReservada: 20,
            precoMedio: '65.00',
          },
        ]}
        patrimonio={{
          patrimonio: '108500.00',
          lucroPrejuizo: '3500.00',
          posicoes: [
            {
              ativo: 'PETR4',
              quantidadeDisponivel: 100,
              quantidadeReservada: 0,
              precoMedio: '30.00',
              precoAtual: '35.00',
              valorAtual: '3500.00',
              lucroPrejuizo: '500.00',
            },
            {
              ativo: 'VALE3',
              quantidadeDisponivel: 50,
              quantidadeReservada: 20,
              precoMedio: '65.00',
              precoAtual: '60.00',
              valorAtual: '4200.00',
              lucroPrejuizo: '-350.00',
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('R$ 85.000,00')).toBeTruthy();
    expect(screen.getByText('R$ 15.000,00')).toBeTruthy();
    expect(screen.getByText('R$ 108.500,00')).toBeTruthy();

    // P/L Geral positivo com sinal explícito e classe alta
    const plGeral = screen.getByText('+R$ 3.500,00');
    expect(plGeral).toBeTruthy();
    expect(plGeral.className).toContain('alta');

    // P/L PETR4 positivo com sinal e classe alta
    const plPetr = screen.getByText('+R$ 500,00');
    expect(plPetr).toBeTruthy();
    expect(plPetr.className).toContain('alta');

    // P/L VALE3 negativo com sinal e classe queda
    const plVale = screen.getByText('-R$ 350,00');
    expect(plVale).toBeTruthy();
    expect(plVale.className).toContain('queda');
  });
});
