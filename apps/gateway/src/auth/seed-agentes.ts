import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash } from '@node-rs/argon2';
import type { AppConfig } from '../config/config.module';
import { DatabaseService } from '../database/database.service';
import { inserirAgente, inserirPosicoesIniciais } from './auth.queries';

export type PerfilAgente = 'conservador' | 'agressivo';

/** Nome de usuário do n-ésimo agente de um perfil. O serviço `agents` usa a mesma regra. */
export function nomeDoAgente(perfil: PerfilAgente, n: number): string {
  return `agente-${perfil}-${n}`;
}

/**
 * Seed dos agentes (RF-019, RF-020, AP-05): ao subir, garante que existam
 * AGENTES_CONSERVADORES + AGENTES_AGRESSIVOS investidores do tipo `agente`, com o mesmo
 * saldo e as mesmas ações de um humano (S-01) e senha AGENTES_SENHA. É idempotente: quem
 * já existe fica como está, inclusive o saldo que já negociou.
 *
 * Fica no `auth`, e não em `database/seed` como diz a arquitetura §2, porque precisa do
 * mesmo hash argon2 do cadastro.
 */
@Injectable()
export class SeedAgentes implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedAgentes.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(ConfigService) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const perfis: [PerfilAgente, number][] = [
      ['conservador', this.config.get('AGENTES_CONSERVADORES', { infer: true })],
      ['agressivo', this.config.get('AGENTES_AGRESSIVOS', { infer: true })],
    ];
    const senhaHash = await hash(this.config.get('AGENTES_SENHA', { infer: true }));
    let criados = 0;
    for (const [perfil, quantos] of perfis) {
      for (let n = 1; n <= quantos; n++) {
        const id = await this.db.transacao(async (cliente) => {
          const novo = await inserirAgente(cliente, {
            nomeUsuario: nomeDoAgente(perfil, n),
            senhaHash,
            perfil,
            saldoInicial: this.config.get('SALDO_INICIAL', { infer: true }),
          });
          if (novo !== undefined) {
            await inserirPosicoesIniciais(
              cliente,
              novo,
              this.config.get('ACOES_INICIAIS', { infer: true }),
            );
          }
          return novo;
        });
        if (id !== undefined) criados++;
      }
    }
    this.logger.log({ criados, perfis: Object.fromEntries(perfis) }, 'seed dos agentes');
  }
}
