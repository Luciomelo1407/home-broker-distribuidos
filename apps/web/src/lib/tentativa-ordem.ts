import type { CriarOrdemRequisicaoDto, LadoOrdem, OrdemResumoDto } from '@bolsa/contracts';
import { resultadoIncerto } from '../api/rest';

/** UUID v4 também em HTTP por IP: getRandomValues não exige contexto seguro. */
export function gerarClientOrderId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 15) | 64;
  bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function prepararOrdem(
  ativo: string,
  lado: LadoOrdem,
  quantidade: string,
  preco: string,
): Omit<CriarOrdemRequisicaoDto, 'clientOrderId'> {
  const qtd = Number(quantidade);
  const valor = preco.trim().replace(',', '.');
  if (!/^[A-Z]{3,4}\d{1,2}$/.test(ativo)) throw new Error('Selecione um ativo válido.');
  if (!/^\d+$/.test(quantidade) || !Number.isSafeInteger(qtd) || qtd < 1 || qtd > 2_147_483_647)
    throw new Error('Quantidade deve ser inteira, entre 1 e 2.147.483.647.');
  if (!/^(?!0+(\.0{1,2})?$)\d{1,13}(\.\d{1,2})?$/.test(valor))
    throw new Error('Preço deve ser maior que zero, com até duas casas decimais.');
  return { ativo, lado, quantidade: qtd, preco: valor };
}

/** Uma intenção incerta conserva o UUID e todo o conteúdo até confirmação ou recusa definitiva. */
export class TentativaOrdem {
  private corpo?: CriarOrdemRequisicaoDto;
  private ocupada = false;
  private armazenamento?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  private chave = '';

  /** Preserva uma tentativa não confirmada após F5, isolada por investidor e por aba. */
  restaurar(
    armazenamento: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
    chave: string,
  ): CriarOrdemRequisicaoDto | undefined {
    this.armazenamento = armazenamento;
    this.chave = chave;
    if (this.corpo) return { ...this.corpo };
    try {
      const texto = armazenamento.getItem(chave);
      if (!texto) return;
      const dados = JSON.parse(texto) as CriarOrdemRequisicaoDto;
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          dados.clientOrderId,
        ) ||
        !['COMPRA', 'VENDA'].includes(dados.lado)
      )
        return;
      const validos = prepararOrdem(dados.ativo, dados.lado, String(dados.quantidade), dados.preco);
      this.corpo = { ...validos, clientOrderId: dados.clientOrderId };
      return { ...this.corpo };
    } catch {
      return undefined;
    }
  }

  private persistir(): void {
    try {
      if (this.corpo) this.armazenamento?.setItem(this.chave, JSON.stringify(this.corpo));
      else this.armazenamento?.removeItem(this.chave);
    } catch {
      /* Armazenamento bloqueado mantém a proteção em memória nesta página. */
    }
  }

  estaOcupada(): boolean {
    return this.ocupada;
  }
  estaIncerta(): boolean {
    return Boolean(this.corpo) && !this.ocupada;
  }
  iniciar(
    dados: Omit<CriarOrdemRequisicaoDto, 'clientOrderId'>,
  ): CriarOrdemRequisicaoDto | undefined {
    if (this.ocupada) return undefined;
    this.corpo ??= { ...dados, clientOrderId: gerarClientOrderId() };
    this.persistir();
    this.ocupada = true;
    return { ...this.corpo };
  }
  confirmar(): void {
    this.corpo = undefined;
    this.ocupada = false;
    this.persistir();
  }
  falhar(erro: unknown, clientOrderId: string): boolean {
    if (this.corpo?.clientOrderId !== clientOrderId) return false;
    this.ocupada = false;
    if (!resultadoIncerto(erro)) this.corpo = undefined;
    this.persistir();
    return true;
  }
  reconhecer(ordens: OrdemResumoDto[]): OrdemResumoDto | undefined {
    const confirmada =
      this.corpo && ordens.find((o) => o.clientOrderId === this.corpo?.clientOrderId);
    if (confirmada) this.confirmar();
    return confirmada;
  }
}
