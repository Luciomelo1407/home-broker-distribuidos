import type { AtivoMercadoDto } from '@bolsa/contracts';
import { formatarDinheiro, formatarQuantidade, formatarVariacao } from '../lib/formato';

interface Props {
  mercado: AtivoMercadoDto[];
  nomes: Record<string, string>;
  aoEscolher: (ativo: AtivoMercadoDto) => void;
}

/** RF-006: preço atual, variação desde o início e volume, iguais para todos. */
export function Mercado({ mercado, nomes, aoEscolher }: Props) {
  return (
    <section className="cartao">
      <h2>Mercado</h2>
      <table>
        <thead>
          <tr>
            <th>Ativo</th>
            <th className="num">Preço</th>
            <th className="num">Variação</th>
            <th className="num">Volume</th>
          </tr>
        </thead>
        <tbody>
          {mercado.map((a) => (
            <tr
              key={a.ativo}
              className="clicavel"
              onClick={() => aoEscolher(a)}
              title="Usar na ordem"
            >
              <td>
                <strong>{a.ativo}</strong>
                {nomes[a.ativo] && <span className="sutil"> {nomes[a.ativo]}</span>}
              </td>
              <td className="num">{formatarDinheiro(a.precoAtual)}</td>
              <td
                className={`num ${a.variacao.startsWith('-') ? 'queda' : /[1-9]/.test(a.variacao) ? 'alta' : ''}`}
              >
                {formatarVariacao(a.variacao)}
              </td>
              <td className="num">{formatarQuantidade(a.volume)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
