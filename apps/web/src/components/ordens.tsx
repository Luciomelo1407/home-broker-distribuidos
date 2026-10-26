'use client';

import type { OrdemResumoDto, OrdemRespostaDto } from '@bolsa/contracts';
import { useEffect, useRef, useState } from 'react';
import { ErroApi, resultadoIncerto } from '../api/rest';
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
  disponivel: boolean;
  consultar: (id: number) => Promise<OrdemRespostaDto>;
}

/**
 * Ordens do investidor e o status de cada uma (RF-008, RF-011), atualizado ao vivo. As
 * abertas e parciais podem ser canceladas (RF-012): o resto volta como reserva liberada.
 */
export function Ordens({ ordens, cancelar, consultar, disponivel }: Props) {
  const [cancelando, setCancelando] = useState<number>();
  const [erro, setErro] = useState<string>();
  const [incerta, setIncerta] = useState<number>();
  const ocupado = useRef(false);
  const versaoConsulta = useRef(0);

  useEffect(
    () => () => {
      versaoConsulta.current++;
    },
    [],
  );

  useEffect(() => {
    if (
      incerta !== undefined &&
      ordens.some((o) => o.id === incerta && o.status !== 'ABERTA' && o.status !== 'PARCIAL')
    ) {
      // Um evento terminal já resolveu a dúvida; uma consulta antiga não pode reabri-la.
      versaoConsulta.current++;
      setIncerta(undefined);
      setErro(undefined);
    }
  }, [ordens, incerta]);

  async function consultarResultado() {
    if (incerta === undefined || ocupado.current) return;
    ocupado.current = true;
    const versao = ++versaoConsulta.current;
    try {
      const ordem = await consultar(incerta);
      if (versao !== versaoConsulta.current) return;
      if (ordem.status !== 'ABERTA' && ordem.status !== 'PARCIAL') {
        setIncerta(undefined);
        setErro(undefined);
      } else
        setErro(
          'A ordem ainda está aberta. O cancelamento não foi confirmado; nenhuma solicitação foi repetida.',
        );
    } catch (e) {
      if (versao === versaoConsulta.current)
        setErro(e instanceof ErroApi ? e.message : 'não foi possível consultar o resultado');
    } finally {
      ocupado.current = false;
    }
  }

  async function pedirCancelamento(id: number) {
    if (ocupado.current || incerta !== undefined || !disponivel) return;
    ocupado.current = true;
    setErro(undefined);
    setCancelando(id);
    try {
      await cancelar(id);
    } catch (e) {
      if (resultadoIncerto(e)) setIncerta(id);
      setErro(e instanceof ErroApi ? e.message : 'erro inesperado');
    } finally {
      setCancelando(undefined);
      ocupado.current = false;
    }
  }

  return (
    <section className="cartao">
      <h2>Minhas ordens</h2>
      {incerta !== undefined && (
        <p className="erro" role="status">
          Cancelamento da ordem #{incerta} ainda não confirmado.{' '}
          <button type="button" className="secundario" onClick={() => void consultarResultado()}>
            Consultar resultado
          </button>
        </p>
      )}
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
                      disabled={cancelando !== undefined || incerta !== undefined || !disponivel}
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
