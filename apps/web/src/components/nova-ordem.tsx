'use client';

import type {
  CriarOrdemRequisicaoDto,
  LadoOrdem,
  OrdemRespostaDto,
  OrdemResumoDto,
} from '@bolsa/contracts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ErroApi } from '../api/rest';
import { prepararOrdem, TentativaOrdem } from '../lib/tentativa-ordem';

interface Props {
  ativos: string[];
  sugestao?: { ativo: string; preco: string };
  enviar: (ordem: CriarOrdemRequisicaoDto) => Promise<OrdemRespostaDto>;
  ordens: OrdemResumoDto[];
  disponivel: boolean;
  investidorId: number;
}

const MOTIVOS: Record<string, string> = {
  SALDO_INSUFICIENTE: 'saldo insuficiente',
  ACOES_INSUFICIENTES: 'ações insuficientes',
  ATIVO_INEXISTENTE: 'ativo inexistente',
  COMANDO_EXPIRADO: 'o mercado demorou a responder; envie de novo',
};

/** RF-009/RF-010: ordem limitada. A validação aqui é só conforto; quem decide é o Gateway. */
export function NovaOrdem({ ativos, sugestao, enviar, ordens, disponivel, investidorId }: Props) {
  const [ativo, setAtivo] = useState(ativos[0] ?? '');
  const [lado, setLado] = useState<LadoOrdem>('COMPRA');
  const [quantidade, setQuantidade] = useState('100');
  const [preco, setPreco] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string }>();
  const [enviando, setEnviando] = useState(false);
  const tentativa = useRef(new TentativaOrdem());
  const [incerta, setIncerta] = useState(false);

  useEffect(() => {
    try {
      const anterior = tentativa.current.restaurar(
        sessionStorage,
        `bolsa.tentativa.${investidorId}`,
      );
      if (anterior) {
        setAtivo(anterior.ativo);
        setLado(anterior.lado);
        setQuantidade(String(anterior.quantidade));
        setPreco(anterior.preco);
        setIncerta(true);
      }
    } catch {
      /* O navegador pode negar sessionStorage; a tentativa segue protegida em memória. */
    }
  }, [investidorId]);

  useEffect(() => {
    if (!ativo && ativos[0]) setAtivo(ativos[0]);
  }, [ativos, ativo]);

  useEffect(() => {
    if (sugestao && !incerta && !enviando) {
      setAtivo(sugestao.ativo);
      setPreco(sugestao.preco);
    }
  }, [sugestao, incerta, enviando]);

  useEffect(() => {
    const confirmada = tentativa.current.reconhecer(ordens);
    if (confirmada) {
      setIncerta(false);
      setAviso({
        tipo: confirmada.status === 'REJEITADA' ? 'erro' : 'ok',
        texto: `Resultado confirmado: ordem #${confirmada.id} ${confirmada.status.toLowerCase()}.`,
      });
    }
  }, [ordens]);

  async function confirmar(evento: FormEvent) {
    evento.preventDefault();
    if (tentativa.current.estaOcupada() || !disponivel) return;
    setAviso(undefined);
    let corpo: CriarOrdemRequisicaoDto | undefined;
    try {
      corpo = tentativa.current.iniciar(prepararOrdem(ativo, lado, quantidade, preco));
    } catch (erro) {
      setAviso({ tipo: 'erro', texto: erro instanceof Error ? erro.message : 'dados inválidos' });
      return;
    }
    if (!corpo) return;
    setEnviando(true);
    try {
      const ordem = await enviar(corpo);
      const confirmadaPorEvento = !tentativa.current.estaOcupada();
      tentativa.current.confirmar();
      setIncerta(false);
      if (confirmadaPorEvento) return;
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
      if (!tentativa.current.falhar(e, corpo.clientOrderId)) return;
      setIncerta(tentativa.current.estaIncerta());
      setAviso({ tipo: 'erro', texto: erro?.message ?? 'erro inesperado' });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="cartao">
      <h2>Nova ordem</h2>
      {!disponivel && (
        <p className="sutil" role="status">
          Aguarde a conexão, a sincronização e a disponibilidade do mercado para enviar.
        </p>
      )}
      {incerta && (
        <p className="erro" role="status">
          Resultado ainda não confirmado. Os campos estão preservados. Aguarde o histórico ou repita
          manualmente a mesma solicitação com o mesmo identificador.
        </p>
      )}
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
              disabled={enviando || incerta || !disponivel}
            >
              {l === 'COMPRA' ? 'Comprar' : 'Vender'}
            </button>
          ))}
        </div>
        <label>
          Ativo
          <select
            value={ativo}
            onChange={(e) => setAtivo(e.target.value)}
            disabled={enviando || incerta || !disponivel}
            required
          >
            {ativos.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label>
          Quantidade
          <input
            inputMode="numeric"
            disabled={enviando || incerta || !disponivel}
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
            disabled={enviando || incerta || !disponivel}
            pattern="[0-9]+([.,][0-9]{1,2})?"
            placeholder="25.00"
            value={preco}
            onChange={(e) => setPreco(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={enviando || !ativo || !disponivel}>
          {enviando
            ? 'Enviando…'
            : incerta
              ? 'Repetir a mesma solicitação'
              : lado === 'COMPRA'
                ? 'Enviar compra'
                : 'Enviar venda'}
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
