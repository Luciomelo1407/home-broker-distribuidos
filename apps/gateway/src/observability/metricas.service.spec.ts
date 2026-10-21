import { MetricasService } from './metricas.service';

describe('MetricasService', () => {
  it('conta as ordens por resultado e registra a latência (RF-026)', async () => {
    const metricas = new MetricasService();

    metricas.ordemProcessada('aceita', 0.012);
    metricas.ordemProcessada('aceita', 0.02);
    metricas.ordemProcessada('nao_confirmada', 3);
    const texto = await metricas.expor();

    expect(texto).toContain('bolsa_ordens_processadas_total{resultado="aceita"} 2');
    expect(texto).toContain('bolsa_ordens_processadas_total{resultado="nao_confirmada"} 1');
    expect(texto).toContain('bolsa_ordem_latencia_segundos_count 3');
  });

  it('acompanha as conexões e os erros', async () => {
    const metricas = new MetricasService();

    metricas.clienteConectou();
    metricas.clienteConectou();
    metricas.clienteDesconectou();
    metricas.erro('http_5xx');
    const texto = await metricas.expor();

    expect(texto).toContain('bolsa_clientes_conectados 1');
    expect(texto).toContain('bolsa_erros_total{tipo="http_5xx"} 1');
    // Métricas do processo, para CPU e memória no relatório de carga
    expect(texto).toContain('bolsa_gateway_process_cpu_seconds_total');
  });

  it('duas instâncias não colidem no registro (vários AppModule nos testes)', () => {
    expect(() => [new MetricasService(), new MetricasService()]).not.toThrow();
  });
});
