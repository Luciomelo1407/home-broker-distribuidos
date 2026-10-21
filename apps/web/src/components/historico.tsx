import type { NegocioDoInvestidorDto } from '@bolsa/contracts';
import { formatarDinheiro, formatarHora, formatarQuantidade } from '../lib/formato';

/** RF-008: os negócios em que o investidor comprou ou vendeu. As ordens ficam em "Minhas ordens". */
export function Historico({ negocios }: { negocios: NegocioDoInvestidorDto[] }) {
  return (
    <section className="cartao">
      <h2>Meus negócios</h2>
      {negocios.length === 0 ? (
        <p className="sutil">Nenhum negócio seu ainda.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Hora</th>
              <th>Ativo</th>
              <th>Lado</th>
              <th className="num">Quantidade</th>
              <th className="num">Preço</th>
              <th>Ordem</th>
            </tr>
          </thead>
          <tbody>
            {negocios.map((n) => (
              <tr key={`${n.id}-${n.ordemId}`}>
                <td>{formatarHora(n.momento)}</td>
                <td>{n.ativo}</td>
                <td className={n.lado === 'COMPRA' ? 'alta' : 'queda'}>
                  {n.lado === 'COMPRA' ? 'Compra' : 'Venda'}
                </td>
                <td className="num">{formatarQuantidade(n.quantidade)}</td>
                <td className="num">{formatarDinheiro(n.preco)}</td>
                <td className="sutil">#{n.ordemId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
