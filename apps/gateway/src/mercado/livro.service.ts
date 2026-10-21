import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subject, type Subscription } from 'rxjs';
import { BusService } from '../bus/bus.service';
import { DatabaseService } from '../database/database.service';
import { buscarLivro, listarAtivos, type LivroDto } from './mercado.queries';

/** Comandos seguidos no mesmo ativo dentro desta janela viram uma releitura só. */
export const JANELA_LIVRO_MS = 50;

/**
 * Livro de ofertas agregado de cada ativo (RF-007), em memória. É relido do Postgres
 * depois de cada resultado do Motor que mexeu no ativo: o Motor só publica depois do
 * COMMIT, então a releitura já enxerga a mudança. Assim o livro sai do mesmo lugar que
 * o resto do estado, e o Motor não precisa publicar nada novo (docs/integracao.md §5).
 */
@Injectable()
export class LivroService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LivroService.name);
  private readonly livros = new Map<string, LivroDto>();
  private readonly pendentes = new Map<string, NodeJS.Timeout>();
  private readonly mudancas = new Subject<LivroDto>();
  private assinatura?: Subscription;

  /** Cada livro que mudou, para o `realtime` mandar como `LIVRO` a todos. */
  readonly livros$ = this.mudancas.asObservable();

  constructor(
    private readonly db: DatabaseService,
    @Inject(BusService) private readonly bus: Pick<BusService, 'resultados$'>,
  ) {}

  async onModuleInit(): Promise<void> {
    for (const { codigo } of await listarAtivos(this.db)) {
      this.livros.set(codigo, await buscarLivro(this.db, codigo));
    }
    this.assinatura = this.bus.resultados$.subscribe((resultado) => {
      for (const ordem of resultado.ordensAtualizadas) this.agendar(ordem.ativo);
    });
  }

  onModuleDestroy(): void {
    this.assinatura?.unsubscribe();
    for (const timer of this.pendentes.values()) clearTimeout(timer);
    this.pendentes.clear();
    this.mudancas.complete();
  }

  /** RF-007: o livro atual de um ativo, ou `undefined` se o ativo não existe. */
  livro(codigo: string): LivroDto | undefined {
    return this.livros.get(codigo);
  }

  /** Todos os livros, para mandar depois do SNAPSHOT. */
  todos(): LivroDto[] {
    return [...this.livros.values()];
  }

  private agendar(codigo: string): void {
    if (!this.livros.has(codigo) || this.pendentes.has(codigo)) return;
    this.pendentes.set(
      codigo,
      setTimeout(() => {
        this.pendentes.delete(codigo);
        buscarLivro(this.db, codigo)
          .then((livro) => {
            this.livros.set(codigo, livro);
            this.mudancas.next(livro);
          })
          .catch((erro: unknown) =>
            this.logger.error({ ativo: codigo, erro: String(erro) }, 'falha ao reler o livro'),
          );
      }, JANELA_LIVRO_MS),
    );
  }
}
