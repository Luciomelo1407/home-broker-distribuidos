import type { LadoOrdem, LivroRespostaDto, OrdemResumoDto, PosicaoDto } from '@bolsa/contracts';

/** O que o agente sabe do mercado na hora de decidir (só o que a API dá a qualquer um). */
export interface VisaoDoMercado {
  /** Preço atual (último negócio) de cada ativo, como string decimal. */
  precos: Record<string, string>;
  /** Preço do ativo na decisão anterior deste agente, para medir a tendência. */
  precosAnteriores: Record<string, string>;
  /** Variação % desde o preço de referência (RF-006), como string ("-1.25"). */
  variacoes: Record<string, string>;
  livros: Record<string, LivroRespostaDto>;
}

/** A carteira do próprio agente. */
export interface CarteiraDoAgente {
  saldoDisponivel: string;
  posicoes: PosicaoDto[];
  ordensAbertas: OrdemResumoDto[];
}

/** Uma ordem que o agente quer mandar; o `clientOrderId` é posto por quem envia. */
export interface IntencaoDeOrdem {
  ativo: string;
  lado: LadoOrdem;
  quantidade: number;
  preco: string;
}

/**
 * Estratégia de um perfil de agente (arquitetura §3.1, Strategy). Função pura: o sorteio
 * entra como parâmetro (`aleatorio` devolve [0, 1)), para os testes serem determinísticos.
 */
export interface Estrategia {
  readonly perfil: 'conservador' | 'agressivo';
  /** Milissegundos entre uma decisão e a próxima (antes do sorteio de ±50%). */
  readonly intervaloMs: number;
  decidir(
    mercado: VisaoDoMercado,
    carteira: CarteiraDoAgente,
    aleatorio: () => number,
  ): IntencaoDeOrdem[];
}
