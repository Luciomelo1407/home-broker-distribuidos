import type { AtivoMercadoDto, MercadoRespostaDto } from '@bolsa/contracts';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { listarAtivos } from './mercado.queries';

type AtivoDoMercado = MercadoRespostaDto['ativos'][number];

/**
 * Snapshot do mercado em memória (arquitetura §2, `gateway/mercado`). Carrega os ativos
 * do Postgres ao subir e depois é atualizado pelos eventos `PRECO` do Motor, para que
 * `GET /mercado` e o `SNAPSHOT` do WebSocket não consultem o banco a cada pedido.
 */
@Injectable()
export class MercadoService implements OnModuleInit {
  private readonly logger = new Logger(MercadoService.name);
  private readonly ativos = new Map<string, AtivoDoMercado>();

  constructor(private readonly db: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.recarregar();
  }

  /** Relê todos os ativos do banco (subida e, na F3, reconexão ao Redis). */
  async recarregar(): Promise<void> {
    for (const linha of await listarAtivos(this.db)) {
      this.ativos.set(linha.codigo, { ...linha, volume: Number(linha.volume) });
    }
  }

  /** RF-006: preço atual, de referência, variação % e volume de cada ativo. */
  listar(): MercadoRespostaDto {
    return { ativos: [...this.ativos.values()] };
  }

  /** Parte `mercado` do evento `SNAPSHOT` (RF-004). */
  resumo(): AtivoMercadoDto[] {
    return [...this.ativos.values()].map(({ codigo, precoAtual, variacao, volume }) => ({
      ativo: codigo,
      precoAtual,
      variacao,
      volume,
    }));
  }

  /** RF-017/RF-018: aplica um evento `PRECO` publicado pelo Motor depois de um negócio. */
  aplicarPreco(preco: AtivoMercadoDto): void {
    const atual = this.ativos.get(preco.ativo);
    if (!atual) {
      this.logger.warn({ ativo: preco.ativo }, 'evento PRECO de ativo desconhecido ignorado');
      return;
    }
    this.ativos.set(preco.ativo, {
      ...atual,
      precoAtual: preco.precoAtual,
      variacao: preco.variacao,
      volume: preco.volume,
    });
  }
}
