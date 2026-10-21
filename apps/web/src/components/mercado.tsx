import type { AtivoMercadoDto } from '@bolsa/contracts';
import { formatarDinheiro, formatarQuantidade, formatarVariacao } from '../lib/formato';

interface Props {
  mercado: AtivoMercadoDto[];
  nomes: Record<string, string>;
  selecionado?: string;
  aoEscolher: (ativo: AtivoMercadoDto) => void;
}

/** RF-006: preço atual, variação desde o início e volume, iguais para todos. Clicar seleciona o livro. */
export function Mercado({ mercado, nomes, selecionado, aoEscolher }: Props) {
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
              className={`clicavel ${a.ativo === selecionado ? 'selecionado' : ''}`}
              onClick={() => aoEscolher(a)}
              title="Ver o livro e usar na ordem"
            >
              <td>
                <button
                  type="button"
                  className="secundario pequeno"
                  aria-label={`Selecionar ${a.ativo}`}
                  aria-pressed={a.ativo === selecionado}
                  onClick={(evento) => {
                    evento.stopPropagation();
                    aoEscolher(a);
                  }}
                >
                  {a.ativo}
                </button>
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
