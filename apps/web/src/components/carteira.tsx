import type { CarteiraRespostaDto, PosicaoDto } from '@bolsa/contracts';
import { formatarDinheiro, formatarQuantidade } from '../lib/formato';

interface Props {
  saldoDisponivel: string;
  saldoReservado?: string;
  posicoes: PosicaoDto[];
  patrimonio?: Pick<CarteiraRespostaDto, 'patrimonio' | 'lucroPrejuizo' | 'posicoes'>;
}

const classeDoSinal = (valor: string) =>
  valor.startsWith('-') ? 'queda' : /[1-9]/.test(valor) ? 'alta' : '';

/**
 * RF-005: saldo, ações com preço médio, patrimônio e lucro/prejuízo. Os valores vêm
 * prontos do Gateway (RNF-10); a tela só formata.
 */
export function Carteira({ saldoDisponivel, saldoReservado, posicoes, patrimonio }: Props) {
  const pl = (ativo: string) => patrimonio?.posicoes.find((p) => p.ativo === ativo)?.lucroPrejuizo;
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
        {patrimonio && (
          <>
            <div>
              <dt>Patrimônio</dt>
              <dd>{formatarDinheiro(patrimonio.patrimonio)}</dd>
            </div>
            <div>
              <dt>Lucro / prejuízo</dt>
              <dd className={classeDoSinal(patrimonio.lucroPrejuizo)}>
                {formatarDinheiro(patrimonio.lucroPrejuizo)}
              </dd>
            </div>
          </>
        )}
      </dl>
      <table>
        <thead>
          <tr>
            <th>Ativo</th>
            <th className="num">Disponível</th>
            <th className="num">Reservada</th>
            <th className="num">Preço médio</th>
            <th className="num">P/L</th>
          </tr>
        </thead>
        <tbody>
          {posicoes.map((p) => (
            <tr key={p.ativo}>
              <td>{p.ativo}</td>
              <td className="num">{formatarQuantidade(p.quantidadeDisponivel)}</td>
              <td className="num">{formatarQuantidade(p.quantidadeReservada)}</td>
              <td className="num">{formatarDinheiro(p.precoMedio)}</td>
              <td className={`num ${classeDoSinal(pl(p.ativo) ?? '')}`}>
                {pl(p.ativo) === undefined ? '—' : formatarDinheiro(pl(p.ativo) ?? '0')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
