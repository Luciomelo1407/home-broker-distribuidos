import type { OrdemResumoDto } from '@bolsa/contracts';
import { formatarDinheiro, formatarQuantidade } from '../lib/formato';

const STATUS: Record<OrdemResumoDto['status'], string> = {
  ABERTA: 'Aberta',
  PARCIAL: 'Parcial',
  EXECUTADA: 'Executada',
  CANCELADA: 'Cancelada',
  REJEITADA: 'Rejeitada',
};

/** Ordens do investidor e o status de cada uma (RF-011), atualizado ao vivo. */
export function Ordens({ ordens }: { ordens: OrdemResumoDto[] }) {
  return (
    <section className="cartao">
      <h2>Minhas ordens</h2>
      {ordens.length === 0 ? (
        <p className="sutil">Nenhuma ordem ainda.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Ativo</th>
              <th>Lado</th>
              <th className="num">Preço</th>
              <th className="num">Executada</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {ordens.map((o) => (
              <tr key={o.id}>
                <td>{o.id}</td>
                <td>{o.ativo}</td>
                <td className={o.lado === 'COMPRA' ? 'alta' : 'queda'}>
                  {o.lado === 'COMPRA' ? 'Compra' : 'Venda'}
                </td>
                <td className="num">{formatarDinheiro(o.precoLimite)}</td>
                <td className="num">
                  {formatarQuantidade(o.quantidadeExecutada)} / {formatarQuantidade(o.quantidade)}
                </td>
                <td>
                  <span className={`etiqueta ${o.status.toLowerCase()}`}>{STATUS[o.status]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
