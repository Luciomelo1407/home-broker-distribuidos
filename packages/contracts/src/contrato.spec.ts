import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import _AjvModule, { type Ajv as AjvType, type Options, type ValidateFunction } from 'ajv';
import _addFormatsModule from 'ajv-formats';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCHEMAS_DIR = join(__dirname, '../schemas');
const FIXTURES_VALIDAS_DIR = join(__dirname, '../fixtures/validas');
const FIXTURES_INVALIDAS_DIR = join(__dirname, '../fixtures/invalidas');

function carregarJson(caminho: string): unknown {
  return JSON.parse(readFileSync(caminho, 'utf-8'));
}

describe('Contratos T-14 (lado TS com Ajv)', () => {
  type AjvCtor = new (opts?: Options) => AjvType;
  const AjvClass = ((_AjvModule as unknown as { default?: AjvCtor }).default ??
    _AjvModule) as AjvCtor;
  const ajv = new AjvClass({ allErrors: true, strict: false });

  const aplicarFormatos = ((_addFormatsModule as unknown as { default?: unknown }).default ??
    _addFormatsModule) as (instanciaAjv: AjvType) => void;
  aplicarFormatos(ajv);

  const schemaEventoMercado = carregarJson(join(SCHEMAS_DIR, 'evento-mercado.json')) as {
    $id: string;
  };
  const schemaApiRest = carregarJson(join(SCHEMAS_DIR, 'api-rest.json')) as {
    $id: string;
    definitions: Record<string, object>;
  };

  const schemaComandoOrdem = carregarJson(join(SCHEMAS_DIR, 'comando-ordem.json')) as {
    $id: string;
  };
  const schemaResultadoOrdem = carregarJson(join(SCHEMAS_DIR, 'resultado-ordem.json')) as {
    $id: string;
  };

  ajv.addSchema(schemaEventoMercado);
  ajv.addSchema(schemaApiRest);
  ajv.addSchema(schemaComandoOrdem);
  ajv.addSchema(schemaResultadoOrdem);

  const validarEvento = ajv.getSchema(schemaEventoMercado.$id);
  if (!validarEvento) {
    throw new Error('Falha ao compilar schema de EventoMercado');
  }

  const validadoresApi: Record<string, ValidateFunction> = {};
  for (const nomeDefinicao of Object.keys(schemaApiRest.definitions)) {
    const validador = ajv.getSchema(`${schemaApiRest.$id}#/definitions/${nomeDefinicao}`);
    if (validador) {
      validadoresApi[nomeDefinicao] = validador;
    }
  }

  const MAPEAMENTO_FIXTURES_API: Record<string, string> = {
    'api-cadastro-req.json': 'AuthCadastroRequisicao',
    'api-cadastro-res.json': 'AuthCadastroResposta',
    'api-login-req.json': 'AuthLoginRequisicao',
    'api-login-res.json': 'AuthLoginResposta',
    'api-ordem-req.json': 'CriarOrdemRequisicao',
    'api-ordem-res.json': 'OrdemResposta',
    'api-carteira-res.json': 'CarteiraResposta',
    'api-mercado-res.json': 'MercadoResposta',
    'api-erro.json': 'RespostaErro',
    'api-livro-res.json': 'LivroResposta',
    'api-livro-quantidade-zero.json': 'LivroResposta',
    'api-erro-nao-cancelavel.json': 'RespostaErro',
    'api-cadastro-nome-curto.json': 'AuthCadastroRequisicao',
    'api-erro-codigo-desconhecido.json': 'RespostaErro',
    'api-ordem-propriedade-extra.json': 'CriarOrdemRequisicao',
    'api-ordem-req-uuid-invalido.json': 'CriarOrdemRequisicao',
  };

  function obterValidador(nomeArquivo: string): ValidateFunction {
    if (nomeArquivo.startsWith('evento-')) {
      return validarEvento as ValidateFunction;
    }
    // Mensagens do Redis (Gateway ⇄ Motor): o lado Rust lê as mesmas fixtures
    const schemaRedis = nomeArquivo.startsWith('comando-')
      ? schemaComandoOrdem
      : nomeArquivo.startsWith('resultado-')
        ? schemaResultadoOrdem
        : undefined;
    const validadorRedis = schemaRedis && ajv.getSchema(schemaRedis.$id);
    if (validadorRedis) {
      return validadorRedis;
    }
    const nomeDefinicao = MAPEAMENTO_FIXTURES_API[nomeArquivo];
    if (nomeDefinicao && validadoresApi[nomeDefinicao]) {
      return validadoresApi[nomeDefinicao];
    }
    throw new Error(`Validador não encontrado para a fixture: ${nomeArquivo}`);
  }

  describe('fixtures válidas', () => {
    const arquivos = readdirSync(FIXTURES_VALIDAS_DIR).filter((f) => f.endsWith('.json'));

    it.each(arquivos)('deve validar com sucesso: %s', (arquivo) => {
      const validador = obterValidador(arquivo);
      const conteudo = carregarJson(join(FIXTURES_VALIDAS_DIR, arquivo));

      const valido = validador(conteudo);
      if (!valido) {
        console.error(`Erros de validação para ${arquivo}:`, validador.errors);
      }
      expect(valido).toBe(true);
    });
  });

  describe('fixtures inválidas', () => {
    const arquivos = readdirSync(FIXTURES_INVALIDAS_DIR).filter((f) => f.endsWith('.json'));

    it.each(arquivos)('deve rejeitar: %s', (arquivo) => {
      const validador = obterValidador(arquivo);
      const conteudo = carregarJson(join(FIXTURES_INVALIDAS_DIR, arquivo));

      const valido = validador(conteudo);
      expect(valido).toBe(false);
    });
  });
});
