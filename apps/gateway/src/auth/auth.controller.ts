import type { AuthCadastroRespostaDto, AuthLoginRespostaDto } from '@bolsa/contracts';
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CredenciaisDto } from './dto/credenciais.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** RF-001 */
  @Post('cadastro')
  @HttpCode(HttpStatus.CREATED)
  cadastrar(@Body() dto: CredenciaisDto): Promise<AuthCadastroRespostaDto> {
    return this.auth.cadastrar(dto);
  }

  /** RF-002 */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  entrar(@Body() dto: CredenciaisDto): Promise<AuthLoginRespostaDto> {
    return this.auth.entrar(dto);
  }
}
