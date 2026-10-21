import type { DatabaseService } from '../database/database.service';
import { MercadoService } from './mercado.service';

const linhas = [
  {
    codigo: 'ABC3',
    nomeEmpresa: 'ABC Tecnologia',
    precoAtual: '25.00',
    precoReferencia: '25.00',
    variacao: '0.00',
    volume: '0',
  },
];

async function criarServico(): Promise<MercadoService> {
  const db = { query: async () => ({ rows: linhas }) } as unknown as DatabaseService;
  const servico = new MercadoService(db);
  await servico.onModuleInit();
  return servico;
}

describe('MercadoService', () => {
  it('carrega os ativos do banco com volume numérico e preços em string', async () => {
    const servico = await criarServico();

    expect(servico.listar()).toEqual({
      ativos: [{ ...linhas[0], volume: 0 }],
    });
  });

  it('aplica o evento PRECO sem perder nome e preço de referência', async () => {
    const servico = await criarServico();

    servico.aplicarPreco({ ativo: 'ABC3', precoAtual: '26.00', variacao: '4.00', volume: 300 });

    expect(servico.listar().ativos[0]).toEqual({
      codigo: 'ABC3',
      nomeEmpresa: 'ABC Tecnologia',
      precoAtual: '26.00',
      precoReferencia: '25.00',
      variacao: '4.00',
      volume: 300,
    });
    expect(servico.resumo()).toEqual([
      { ativo: 'ABC3', precoAtual: '26.00', variacao: '4.00', volume: 300 },
    ]);
  });

  it('ignora evento PRECO de ativo que não existe', async () => {
    const servico = await criarServico();

    servico.aplicarPreco({ ativo: 'XYZ9', precoAtual: '1.00', variacao: '0.00', volume: 1 });

    expect(servico.listar().ativos.map((ativo) => ativo.codigo)).toEqual(['ABC3']);
  });
});
