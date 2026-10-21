import type { AuthCadastroRespostaDto, AuthLoginRespostaDto } from '@bolsa/contracts';
import { HttpStatus, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { AppError, CodigoErro } from '../common/app-error';
import type { UsuarioAutenticado } from '../common/usuario-atual';
import type { AppConfig } from '../config/config.module';
import { DatabaseService } from '../database/database.service';
import { buscarParaLogin, inserirInvestidor, inserirPosicoesIniciais } from './auth.queries';
import type { CredenciaisDto } from './dto/credenciais.dto';

// Código do Postgres para violação de UNIQUE (nome de usuário repetido)
const UNIQUE_VIOLATION = '23505';

/** Conteúdo do JWT. `sub` é o id do investidor: a única identidade aceita (RNF-08). */
interface ConteudoDoToken {
  sub: number;
}

@Injectable()
export class AuthService implements OnModuleInit {
  // Hash de uma senha qualquer: o login de usuário inexistente gasta o mesmo tempo
  // que o de senha errada, então a resposta não revela quem está cadastrado
  private hashFalso = '';

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    @Inject(ConfigService) private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    this.hashFalso = await hash('senha-que-ninguem-usa');
  }

  /**
   * RF-001: cria o investidor com o saldo e as ações iniciais (S-01) numa transação.
   * A senha vai para o banco só como hash argon2id (RNF-06, T-12).
   */
  async cadastrar(dto: CredenciaisDto): Promise<AuthCadastroRespostaDto> {
    const senhaHash = await hash(dto.senha);
    const saldo = this.config.get('SALDO_INICIAL', { infer: true });
    try {
      const id = await this.db.transacao(async (cliente) => {
        const novo = await inserirInvestidor(cliente, dto.nomeUsuario, senhaHash, saldo);
        await inserirPosicoesIniciais(
          cliente,
          novo,
          this.config.get('ACOES_INICIAIS', { infer: true }),
        );
        return novo;
      });
      return { id, nomeUsuario: dto.nomeUsuario, saldoDisponivel: saldo };
    } catch (erro) {
      if ((erro as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new AppError(
          CodigoErro.USUARIO_JA_EXISTE,
          HttpStatus.CONFLICT,
          'nome de usuário já cadastrado',
          ['nomeUsuario'],
        );
      }
      throw erro;
    }
  }

  /** RF-002: troca usuário e senha por um JWT (validade JWT_EXPIRACAO, SD-04). */
  async entrar(dto: CredenciaisDto): Promise<AuthLoginRespostaDto> {
    const linha = await buscarParaLogin(this.db, dto.nomeUsuario);
    const confere = await verify(linha?.senhaHash ?? this.hashFalso, dto.senha);
    if (!linha || !confere) {
      throw new AppError(
        CodigoErro.CREDENCIAIS_INVALIDAS,
        HttpStatus.UNAUTHORIZED,
        'usuário ou senha incorretos',
      );
    }
    const conteudo: ConteudoDoToken = { sub: linha.id };
    return {
      token: await this.jwt.signAsync(conteudo),
      investidor: { id: linha.id, nomeUsuario: dto.nomeUsuario },
    };
  }

  /**
   * Valida um JWT (REST e WebSocket). Devolve `undefined` para token ausente, vencido,
   * com assinatura errada ou sem `sub` numérico.
   */
  async verificar(token: string | undefined): Promise<UsuarioAutenticado | undefined> {
    if (!token) return undefined;
    try {
      const conteudo = await this.jwt.verifyAsync<Partial<ConteudoDoToken>>(token);
      return Number.isSafeInteger(conteudo.sub) && (conteudo.sub ?? 0) > 0
        ? { id: conteudo.sub as number }
        : undefined;
    } catch {
      return undefined;
    }
  }
}
