import { api, ErroApi } from '../api/rest';
import type { Acao, FonteLeitura } from './reducer';

/** RF-004: respostas anteriores à troca de sessão e consultas superadas são descartadas. */
export class LeiturasPainel {
  private ativa = true;
  private versoes: Record<FonteLeitura, number> = { carteira: 0, historico: 0, mercado: 0 };

  constructor(
    private readonly token: string,
    private readonly emitir: (acao: Acao) => void,
    private readonly perderSessao: () => void,
    private readonly cliente: Pick<typeof api, 'carteira' | 'historico' | 'mercado'> = api,
  ) {}

  estaAtiva(): boolean {
    return this.ativa;
  }
  cancelar(): void {
    this.ativa = false;
  }

  carteira(): Promise<void> {
    return this.buscar(
      'carteira',
      () => this.cliente.carteira(this.token),
      (carteira) => ({ tipo: 'CARTEIRA', carteira }),
    );
  }

  historico(): Promise<void> {
    return this.buscar(
      'historico',
      () => this.cliente.historico(this.token),
      (historico) => ({ tipo: 'HISTORICO', historico }),
    );
  }

  mercado(): Promise<void> {
    return this.buscar(
      'mercado',
      () => this.cliente.mercado(),
      (mercado) => ({ tipo: 'MERCADO', mercado }),
    );
  }

  private async buscar<T>(
    fonte: FonteLeitura,
    buscar: () => Promise<T>,
    sucesso: (valor: T) => Acao,
  ): Promise<void> {
    const versao = ++this.versoes[fonte];
    try {
      const valor = await buscar();
      if (this.ativa && versao === this.versoes[fonte]) this.emitir(sucesso(valor));
    } catch (erro) {
      if (!this.ativa || versao !== this.versoes[fonte]) return;
      if (erro instanceof ErroApi && erro.status === 401) {
        this.cancelar();
        this.perderSessao();
      } else {
        this.emitir({
          tipo: 'FALHA_LEITURA',
          fonte,
          mensagem: erro instanceof Error ? erro.message : 'não foi possível atualizar os dados',
        });
      }
    }
  }
}
