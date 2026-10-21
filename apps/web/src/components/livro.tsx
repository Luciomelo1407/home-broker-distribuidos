import type { LivroRespostaDto } from '@bolsa/contracts';
import { formatarDinheiro, formatarQuantidade } from '../lib/formato';

interface Props {
  ativo: string;
  livro?: LivroRespostaDto;
  aoEscolherPreco: (preco: string) => void;
}

/**
 * RF-007: os 5 melhores níveis de compra e de venda do ativo selecionado, agregados por
 * preço pelo Gateway. O primeiro de cada lado é a melhor oferta (RF-006).
 */
export function Livro({ ativo, livro, aoEscolherPreco }: Props) {
  const lado = (titulo: string, classe: string, ofertas: LivroRespostaDto['ofertasCompra']) => (
    <div>
      <h3 className={classe}>{titulo}</h3>
      {ofertas.length === 0 ? (
        <p className="sutil">Sem ofertas.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th className="num">Preço</th>
              <th className="num">Quantidade</th>
            </tr>
          </thead>
          <tbody>
            {ofertas.map((o) => (
              <tr key={o.preco}>
                <td className={`num ${classe}`}>
                  <button
                    type="button"
                    className="secundario pequeno"
                    onClick={() => aoEscolherPreco(o.preco)}
                    aria-label={`Usar preço ${o.preco} na ordem`}
                  >
                    {formatarDinheiro(o.preco)}
                  </button>
                </td>
                <td className="num">{formatarQuantidade(o.quantidade)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <section className="cartao">
      <h2>Livro de ofertas · {ativo}</h2>
      <div className="livro">
        {lado('Compra', 'alta', livro?.ofertasCompra ?? [])}
        {lado('Venda', 'queda', livro?.ofertasVenda ?? [])}
      </div>
    </section>
  );
}
