import type { PosicaoDto } from '@bolsa/contracts';
import { formatarDinheiro, formatarQuantidade } from '../lib/formato';

interface Props {
  saldoDisponivel: string;
  saldoReservado?: string;
  posicoes: PosicaoDto[];
}

/** RF-005 (P1): saldo e ações. Patrimônio e P/L entram na P2, calculados no Gateway. */
export function Carteira({ saldoDisponivel, saldoReservado, posicoes }: Props) {
  return (
    <section className="cartao">
      <h2>Carteira</h2>
      <dl className="saldos">
        <div>
          <dt>Saldo disponível</dt>
          <dd>{formatarDinheiro(saldoDisponivel)}</dd>
        </div>
        {saldoReservado !== undefined && (
          <div>
            <dt>Reservado em ordens</dt>
            <dd>{formatarDinheiro(saldoReservado)}</dd>
          </div>
        )}
      </dl>
      <table>
        <thead>
          <tr>
            <th>Ativo</th>
            <th className="num">Disponível</th>
            <th className="num">Reservada</th>
            <th className="num">Preço médio</th>
          </tr>
        </thead>
        <tbody>
          {posicoes.map((p) => (
            <tr key={p.ativo}>
              <td>{p.ativo}</td>
              <td className="num">{formatarQuantidade(p.quantidadeDisponivel)}</td>
              <td className="num">{formatarQuantidade(p.quantidadeReservada)}</td>
              <td className="num">{formatarDinheiro(p.precoMedio)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
