'use client';

import type { OrdemResumoDto } from '@bolsa/contracts';
import { useState } from 'react';
import { ErroApi } from '../api/rest';
import { formatarDinheiro, formatarQuantidade } from '../lib/formato';

const STATUS: Record<OrdemResumoDto['status'], string> = {
  ABERTA: 'Aberta',
  PARCIAL: 'Parcial',
  EXECUTADA: 'Executada',
  CANCELADA: 'Cancelada',
  REJEITADA: 'Rejeitada',
};

const MOTIVOS: Record<string, string> = {
  SALDO_INSUFICIENTE: 'saldo insuficiente',
  ACOES_INSUFICIENTES: 'ações insuficientes',
  ATIVO_INEXISTENTE: 'ativo inexistente',
  COMANDO_EXPIRADO: 'mercado demorou a responder',
};

interface Props {
  ordens: OrdemResumoDto[];
  cancelar: (id: number) => Promise<unknown>;
}

/**
 * Ordens do investidor e o status de cada uma (RF-008, RF-011), atualizado ao vivo. As
 * abertas e parciais podem ser canceladas (RF-012): o resto volta como reserva liberada.
 */
export function Ordens({ ordens, cancelar }: Props) {
  const [cancelando, setCancelando] = useState<number>();
  const [erro, setErro] = useState<string>();

  async function pedirCancelamento(id: number) {
    setErro(undefined);
    setCancelando(id);
    try {
      await cancelar(id);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'erro inesperado');
    } finally {
      setCancelando(undefined);
    }
  }

  return (
    <section className="cartao">
      <h2>Minhas ordens</h2>
      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}
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
              <th />
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
                  <span
                    className={`etiqueta ${o.status.toLowerCase()}`}
                    title={
                      o.motivoRejeicao ? (MOTIVOS[o.motivoRejeicao] ?? o.motivoRejeicao) : undefined
                    }
                  >
                    {STATUS[o.status]}
                  </span>
                </td>
                <td>
                  {(o.status === 'ABERTA' || o.status === 'PARCIAL') && (
                    <button
                      type="button"
                      className="secundario pequeno"
                      disabled={cancelando === o.id}
                      onClick={() => void pedirCancelamento(o.id)}
                    >
                      {cancelando === o.id ? '…' : 'Cancelar'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
