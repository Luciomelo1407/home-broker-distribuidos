import type { LadoOrdem, MotivoRejeicao, StatusOrdem } from './stage.js';

export interface PosicaoDto {
  ativo: string;
  quantidadeDisponivel: number;
  quantidadeReservada: number;
  precoMedio: string;
}

export interface OrdemResumoDto {
  id: number;
  clientOrderId: string;
  ativo: string;
  lado: LadoOrdem;
  precoLimite: string;
  quantidade: number;
  quantidadeExecutada: number;
  status: StatusOrdem;
  motivoRejeicao?: MotivoRejeicao;
}

export interface AtivoMercadoDto {
  ativo: string;
  precoAtual: string;
  variacao: string;
  volume: number;
}

export interface OfertaLivroDto {
  preco: string;
  quantidade: number;
}

export interface RespostaErroDto {
  erro: {
    codigo: string;
    mensagem: string;
    campos?: string[];
  };
  requestId: string;
}

export interface AuthCadastroRequisicaoDto {
  nomeUsuario: string;
  senha: string;
}

export interface AuthCadastroRespostaDto {
  id: number;
  nomeUsuario: string;
  saldoDisponivel: string;
}

export interface AuthLoginRequisicaoDto {
  nomeUsuario: string;
  senha: string;
}

export interface AuthLoginRespostaDto {
  token: string;
  investidor: {
    id: number;
    nomeUsuario: string;
  };
}

export interface CriarOrdemRequisicaoDto {
  clientOrderId: string;
  ativo: string;
  lado: LadoOrdem;
  quantidade: number;
  preco: string;
}

export interface OrdemRespostaDto extends OrdemResumoDto {
  investidorId: number;
}

/** GET /mercado/livro/:ativo (RF-007): o mesmo formato de `LIVRO.dados`. */
export interface LivroRespostaDto {
  ativo: string;
  ofertasCompra: OfertaLivroDto[];
  ofertasVenda: OfertaLivroDto[];
}

/** Posição do GET /carteira: a do SNAPSHOT mais o valor a preço atual (RF-005 P2). */
export interface PosicaoCarteiraDto extends PosicaoDto {
  precoAtual: string;
  valorAtual: string;
  /** (preço atual − preço médio) × quantidade total; pode ser negativo. */
  lucroPrejuizo: string;
}

export interface CarteiraRespostaDto {
  saldoDisponivel: string;
  saldoReservado: string;
  /** Saldo disponível + reservado + ações a preço atual. */
  patrimonio: string;
  lucroPrejuizo: string;
  posicoes: PosicaoCarteiraDto[];
}

/** Negócio visto por um dos lados (GET /historico, RF-008). */
export interface NegocioDoInvestidorDto {
  id: number;
  ordemId: number;
  ativo: string;
  lado: LadoOrdem;
  preco: string;
  quantidade: number;
  momento: string;
}

export interface HistoricoRespostaDto {
  ordens: OrdemRespostaDto[];
  negocios: NegocioDoInvestidorDto[];
}

export interface MercadoRespostaDto {
  ativos: {
    codigo: string;
    nomeEmpresa: string;
    precoAtual: string;
    precoReferencia: string;
    variacao: string;
    volume: number;
  }[];
}

export type EventoMercado =
  | {
      tipo: 'SNAPSHOT';
      dados: {
        saldo: string;
        posicoes: PosicaoDto[];
        ordensAbertas: OrdemResumoDto[];
        mercado: AtivoMercadoDto[];
      };
    }
  | {
      tipo: 'ORDEM_ATUALIZADA';
      dados: OrdemResumoDto;
    }
  | {
      tipo: 'NEGOCIO';
      dados: {
        id: number;
        ativo: string;
        preco: string;
        quantidade: number;
        momento: string;
      };
    }
  | {
      tipo: 'PRECO';
      dados: AtivoMercadoDto;
    }
  | {
      tipo: 'LIVRO';
      dados: {
        ativo: string;
        ofertasCompra: OfertaLivroDto[];
        ofertasVenda: OfertaLivroDto[];
      };
    }
  | {
      tipo: 'PRESENCA';
      dados: {
        conectados: number;
      };
    }
  | {
      tipo: 'ERRO';
      dados: {
        codigo: string;
        mensagem: string;
      };
    };

// Mensagens do Redis entre Gateway e Motor (schemas comando-ordem e resultado-ordem).

export type ComandoOrdem =
  | {
      tipo: 'CRIAR';
      clientOrderId: string;
      investidorId: number;
      ativo: string;
      lado: LadoOrdem;
      quantidade: number;
      preco: string;
    }
  | {
      tipo: 'CANCELAR';
      clientOrderId: string;
      investidorId: number;
      ordemId: number;
    };

export interface NegocioDto {
  id: number;
  ativo: string;
  preco: string;
  quantidade: number;
  momento: string;
}

export interface ResultadoOrdem {
  clientOrderId: string;
  investidorId: number;
  /** null só quando o comando foi recusado sem ordem para mostrar (aí há motivoRejeicao). */
  ordem: OrdemRespostaDto | null;
  motivoRejeicao?: MotivoRejeicao;
  ordensAtualizadas: OrdemRespostaDto[];
  negocios: NegocioDto[];
  mercado: AtivoMercadoDto[];
}
