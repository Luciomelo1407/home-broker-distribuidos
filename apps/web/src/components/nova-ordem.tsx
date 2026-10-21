'use client';

import type { CriarOrdemRequisicaoDto, LadoOrdem, OrdemRespostaDto } from '@bolsa/contracts';
import { useEffect, useState, type FormEvent } from 'react';
import { ErroApi } from '../api/rest';

interface Props {
  ativos: string[];
  sugestao?: { ativo: string; preco: string };
  enviar: (ordem: CriarOrdemRequisicaoDto) => Promise<OrdemRespostaDto>;
}

const MOTIVOS: Record<string, string> = {
  SALDO_INSUFICIENTE: 'saldo insuficiente',
  ACOES_INSUFICIENTES: 'ações insuficientes',
  ATIVO_INEXISTENTE: 'ativo inexistente',
  COMANDO_EXPIRADO: 'o mercado demorou a responder; envie de novo',
};

/** RF-009/RF-010: ordem limitada. A validação aqui é só conforto; quem decide é o Gateway. */
export function NovaOrdem({ ativos, sugestao, enviar }: Props) {
  const [ativo, setAtivo] = useState(ativos[0] ?? '');
  const [lado, setLado] = useState<LadoOrdem>('COMPRA');
  const [quantidade, setQuantidade] = useState('100');
  const [preco, setPreco] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string }>();
  const [enviando, setEnviando] = useState(false);
  // Reenvio depois de um 504 usa o mesmo id, para o Motor não duplicar (SD-04)
  const [clientOrderId, setClientOrderId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!ativo && ativos[0]) setAtivo(ativos[0]);
  }, [ativos, ativo]);

  useEffect(() => {
    if (sugestao) {
      setAtivo(sugestao.ativo);
      setPreco(sugestao.preco);
    }
  }, [sugestao]);

  async function confirmar(evento: FormEvent) {
    evento.preventDefault();
    setAviso(undefined);
    setEnviando(true);
    try {
      const ordem = await enviar({
        clientOrderId,
        ativo,
        lado,
        quantidade: Number(quantidade),
        preco: preco.replace(',', '.'),
      });
      setClientOrderId(crypto.randomUUID());
      setAviso(
        ordem.status === 'REJEITADA'
          ? {
              tipo: 'erro',
              texto: `Ordem rejeitada: ${MOTIVOS[ordem.motivoRejeicao ?? ''] ?? ordem.motivoRejeicao}`,
            }
          : { tipo: 'ok', texto: `Ordem #${ordem.id} ${ordem.status.toLowerCase()}` },
      );
    } catch (e) {
      const erro = e instanceof ErroApi ? e : undefined;
      // Só um 504 mantém o id: a ordem pode ter entrado, e o reenvio não a duplica
      if (erro?.codigo !== 'NAO_CONFIRMADA') setClientOrderId(crypto.randomUUID());
      setAviso({ tipo: 'erro', texto: erro?.message ?? 'erro inesperado' });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="cartao">
      <h2>Nova ordem</h2>
      <form className="ordem" onSubmit={(e) => void confirmar(e)}>
        <div className="lados" role="radiogroup" aria-label="Lado">
          {(['COMPRA', 'VENDA'] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={lado === l}
              className={`lado ${l.toLowerCase()} ${lado === l ? 'ativo' : ''}`}
              onClick={() => setLado(l)}
            >
              {l === 'COMPRA' ? 'Comprar' : 'Vender'}
            </button>
          ))}
        </div>
        <label>
          Ativo
          <select value={ativo} onChange={(e) => setAtivo(e.target.value)} required>
            {ativos.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label>
          Quantidade
          <input
            inputMode="numeric"
            pattern="[0-9]+"
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            required
          />
        </label>
        <label>
          Preço limite (R$)
          <input
            inputMode="decimal"
            pattern="[0-9]+([.,][0-9]{1,2})?"
            placeholder="25.00"
            value={preco}
            onChange={(e) => setPreco(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={enviando || !ativo}>
          {enviando ? 'Enviando…' : lado === 'COMPRA' ? 'Enviar compra' : 'Enviar venda'}
        </button>
        {aviso && (
          <p className={aviso.tipo} role="status">
            {aviso.texto}
          </p>
        )}
      </form>
    </section>
  );
}
