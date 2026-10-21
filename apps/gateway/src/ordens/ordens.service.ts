import type { OrdemRespostaDto, StageOrdem } from '@bolsa/contracts';
import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError, CodigoErro } from '../common/app-error';
import type { UsuarioAutenticado } from '../common/usuario-atual';
import type { AppConfig } from '../config/config.module';
import { DatabaseService } from '../database/database.service';
import {
  BarramentoDeOrdens,
  BarramentoIndisponivel,
  ComandoNaoConfirmado,
} from './barramento-de-ordens';
import type { CriarOrdemDto } from './dto/criar-ordem.dto';
import { listarCodigosDeAtivos } from './ordens.queries';

const ORDER_RECEIVED: StageOrdem = 'ORDER_RECEIVED';

@Injectable()
export class OrdensService implements OnModuleInit {
  private readonly logger = new Logger(OrdensService.name);
  private ativos = new Set<string>();

  constructor(
    private readonly db: DatabaseService,
    private readonly barramento: BarramentoDeOrdens,
    @Inject(ConfigService) private readonly config: AppConfig,
  ) {}

  /** Carrega os códigos dos ativos uma vez: o conjunto é fixo pela migração 0002. */
  async onModuleInit(): Promise<void> {
    this.ativos = new Set(await listarCodigosDeAtivos(this.db));
  }

  /**
   * Envia a ordem ao Motor e devolve o resultado dele (RF-009, RF-010, RF-011).
   * Ordem rejeitada pelo Motor também é resposta normal: `status = REJEITADA` e
   * `motivoRejeicao` (arquitetura §4.2). Só o formato e o ativo são checados aqui
   * (RNF-07, T-13); saldo e ações são regra do Motor (RNF-10).
   */
  async criar(usuario: UsuarioAutenticado, dto: CriarOrdemDto): Promise<OrdemRespostaDto> {
    if (!this.ativos.has(dto.ativo)) {
      throw new AppError(CodigoErro.VALIDACAO, HttpStatus.BAD_REQUEST, 'ativo inexistente', [
        'ativo',
      ]);
    }

    const inicio = Date.now();
    const log = { clientOrderId: dto.clientOrderId, userId: usuario.id };
    this.logger.log(
      { ...log, stage: ORDER_RECEIVED, ativo: dto.ativo, lado: dto.lado },
      'ordem recebida',
    );

    try {
      // RNF-08: o investidor vem do JWT, nunca do corpo
      const resultado = await this.barramento.enviarEAguardar(
        {
          tipo: 'CRIAR',
          clientOrderId: dto.clientOrderId,
          investidorId: usuario.id,
          ativo: dto.ativo,
          lado: dto.lado,
          quantidade: dto.quantidade,
          preco: dto.preco,
        },
        this.config.get('ORDEM_TIMEOUT_MS', { infer: true }),
      );
      const ordem = resultado.ordem;
      if (!ordem) {
        // Só acontece se o ativo sumir entre a checagem acima e o Motor
        this.logger.error({ ...log, motivo: resultado.motivoRejeicao }, 'Motor recusou sem ordem');
        throw new AppError(CodigoErro.VALIDACAO, HttpStatus.BAD_REQUEST, 'ativo inexistente', [
          'ativo',
        ]);
      }
      this.logger.log(
        { ...log, orderId: ordem.id, status: ordem.status, durMs: Date.now() - inicio },
        'ordem confirmada pelo Motor',
      );
      return ordem;
    } catch (erro) {
      throw this.traduzirFalha(erro, log, inicio);
    }
  }

  private traduzirFalha(erro: unknown, log: object, inicio: number): unknown {
    const durMs = Date.now() - inicio;
    if (erro instanceof ComandoNaoConfirmado) {
      this.logger.warn({ ...log, durMs }, 'Motor não confirmou a ordem no prazo');
      // SD-04: o cliente reenvia com o mesmo clientOrderId, e o Motor não duplica
      return new AppError(
        CodigoErro.NAO_CONFIRMADA,
        HttpStatus.GATEWAY_TIMEOUT,
        'ordem não confirmada a tempo; reenvie com o mesmo clientOrderId',
      );
    }
    if (erro instanceof BarramentoIndisponivel) {
      this.logger.warn({ ...log, durMs }, 'barramento indisponível');
      return new AppError(
        CodigoErro.MERCADO_INDISPONIVEL,
        HttpStatus.SERVICE_UNAVAILABLE,
        'mercado indisponível, tente de novo em instantes',
      );
    }
    return erro;
  }
}
