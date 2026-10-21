import type { NegocioDto } from '@bolsa/contracts';
import { formatarDinheiro, formatarHora, formatarQuantidade } from '../lib/formato';

/** Últimos negócios do mercado, de todos os investidores (RF-018). */
export function Negocios({ negocios }: { negocios: NegocioDto[] }) {
  return (
    <section className="cartao">
      <h2>Últimos negócios</h2>
      {negocios.length === 0 ? (
        <p className="sutil">Nenhum negócio desde que você entrou.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Hora</th>
              <th>Ativo</th>
              <th className="num">Quantidade</th>
              <th className="num">Preço</th>
            </tr>
          </thead>
          <tbody>
            {negocios.map((n) => (
              <tr key={n.id}>
                <td>{formatarHora(n.momento)}</td>
                <td>{n.ativo}</td>
                <td className="num">{formatarQuantidade(n.quantidade)}</td>
                <td className="num">{formatarDinheiro(n.preco)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
