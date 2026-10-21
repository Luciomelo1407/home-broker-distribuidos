import type {
  AtivoMercadoDto,
  CarteiraRespostaDto,
  EventoMercado,
  MercadoRespostaDto,
  NegocioDto,
  OrdemResumoDto,
  PosicaoDto,
} from '@bolsa/contracts';

/** Quantos negócios recentes a tela guarda. */
export const LIMITE_NEGOCIOS = 20;

export interface EstadoTela {
  /** WebSocket aberto agora (RNF-11: a tela mostra "desconectado" quando cai). */
  conectado: boolean;
  /** Já chegou pelo menos um SNAPSHOT. */
  carregado: boolean;
  saldoDisponivel: string;
  /** Só vem do GET /carteira; o SNAPSHOT não traz. */
  saldoReservado?: string;
  posicoes: PosicaoDto[];
  /** Ordens do investidor: as abertas do SNAPSHOT e as que mudaram depois, mais nova primeiro. */
  ordens: OrdemResumoDto[];
  mercado: AtivoMercadoDto[];
  /** Nome da empresa por código, do GET /mercado. */
  nomes: Record<string, string>;
  negocios: NegocioDto[];
  conectados?: number;
  erro?: string;
}

export type Acao =
  | { tipo: 'EVENTO'; evento: EventoMercado }
  | { tipo: 'CONEXAO'; conectado: boolean }
  | { tipo: 'CARTEIRA'; carteira: CarteiraRespostaDto }
  | { tipo: 'MERCADO'; mercado: MercadoRespostaDto }
  | { tipo: 'ORDEM_ENVIADA'; ordem: OrdemResumoDto };

export const estadoInicial: EstadoTela = {
  conectado: false,
  carregado: false,
  saldoDisponivel: '0.00',
  posicoes: [],
  ordens: [],
  mercado: [],
  nomes: {},
  negocios: [],
};

/**
 * Estado da tela a partir do SNAPSHOT e dos eventos (arquitetura §3.1). O SNAPSHOT
 * substitui o que veio do servidor; os demais eventos alteram em cima dele. Função pura:
 * não calcula regra de mercado (RNF-10), só guarda o que o Gateway mandou.
 */
export function reducer(estado: EstadoTela, acao: Acao): EstadoTela {
  switch (acao.tipo) {
    case 'CONEXAO':
      return { ...estado, conectado: acao.conectado };
    case 'CARTEIRA':
      return {
        ...estado,
        saldoDisponivel: acao.carteira.saldoDisponivel,
        saldoReservado: acao.carteira.saldoReservado,
        posicoes: acao.carteira.posicoes,
      };
    case 'MERCADO':
      return {
        ...estado,
        nomes: Object.fromEntries(acao.mercado.ativos.map((a) => [a.codigo, a.nomeEmpresa])),
        mercado: estado.carregado
          ? estado.mercado
          : acao.mercado.ativos.map(({ codigo, precoAtual, variacao, volume }) => ({
              ativo: codigo,
              precoAtual,
              variacao,
              volume,
            })),
      };
    case 'ORDEM_ENVIADA':
      return { ...estado, ordens: comOrdem(estado.ordens, acao.ordem) };
    case 'EVENTO':
      return aplicarEvento(estado, acao.evento);
  }
}

function aplicarEvento(estado: EstadoTela, evento: EventoMercado): EstadoTela {
  switch (evento.tipo) {
    case 'SNAPSHOT':
      return {
        ...estado,
        carregado: true,
        erro: undefined,
        saldoDisponivel: evento.dados.saldo,
        posicoes: evento.dados.posicoes,
        // As já encerradas que a tela viu continuam na lista; as abertas vêm do servidor
        ordens: [
          ...[...evento.dados.ordensAbertas].sort((a, b) => b.id - a.id),
          ...estado.ordens.filter(
            (o) => !abertaOuParcial(o) && !evento.dados.ordensAbertas.some((a) => a.id === o.id),
          ),
        ],
        mercado: evento.dados.mercado,
      };
    case 'ORDEM_ATUALIZADA':
      return { ...estado, ordens: comOrdem(estado.ordens, evento.dados) };
    case 'NEGOCIO':
      if (estado.negocios.some((n) => n.id === evento.dados.id)) return estado;
      return { ...estado, negocios: [evento.dados, ...estado.negocios].slice(0, LIMITE_NEGOCIOS) };
    case 'PRECO': {
      const existe = estado.mercado.some((a) => a.ativo === evento.dados.ativo);
      return {
        ...estado,
        mercado: existe
          ? estado.mercado.map((a) => (a.ativo === evento.dados.ativo ? evento.dados : a))
          : [...estado.mercado, evento.dados],
      };
    }
    case 'PRESENCA':
      return { ...estado, conectados: evento.dados.conectados };
    case 'ERRO':
      return { ...estado, erro: evento.dados.mensagem };
    case 'LIVRO':
      // RF-007 é P2: o livro ainda não aparece na tela
      return estado;
  }
}

/** Substitui a ordem com o mesmo id ou a põe no topo. */
function comOrdem(ordens: OrdemResumoDto[], ordem: OrdemResumoDto): OrdemResumoDto[] {
  const existe = ordens.some((o) => o.id === ordem.id);
  return existe ? ordens.map((o) => (o.id === ordem.id ? ordem : o)) : [ordem, ...ordens];
}

function abertaOuParcial(ordem: OrdemResumoDto): boolean {
  return ordem.status === 'ABERTA' || ordem.status === 'PARCIAL';
}
