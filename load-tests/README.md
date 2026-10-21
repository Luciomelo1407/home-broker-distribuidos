# Testes de carga (k6)

Roteiros para o RNF-04 e o CA-04. Rodam com a imagem oficial do k6, sem instalar nada:

```bash
docker compose up -d --build            # sistema inteiro de pé
docker run --rm --network host -v "$PWD/load-tests:/scripts" grafana/k6 \
  run -e VUS=50 -e DURACAO=1m /scripts/ordens.js
docker compose exec -T postgres psql -U postgres -d bolsa < load-tests/conferencia.sql
```

| Arquivo           | O que faz                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ordens.js`       | `VUS` investidores novos enviando ordens limitadas aleatórias (±2% do preço inicial) pelo REST. Threshold do RNF-03: p95 ≤ 500 ms.                 |
| `tempo-real.mjs`  | RNF-02: abre N Home Brokers (WebSocket) e mede o atraso de cada `NEGOCIO` desde o `executado_em` gravado pelo Motor. Rode junto com o `ordens.js`. |
| `conferencia.sql` | Conservação de dinheiro e ações, reservas iguais ao livro e nada negativo (base do T-15).                                                          |

O `--network host` só funciona no Linux. No Mac/Windows, use `-e GATEWAY=http://host.docker.internal:3001`.

## Primeira medição (M5), 21/10/2026

Máquina de desenvolvimento do Dev 1, não a da demo (D-03 continua em aberto). Sistema inteiro no
compose, banco recém-criado, 20 s por rodada.

| Usuários | Ordens/s | Confirmação p95 | Máx.   | Falhas | Conferência |
| -------- | -------- | --------------- | ------ | ------ | ----------- |
| 5        | 14       | 14 ms           | 46 ms  | 0%     | —           |
| 20       | ~55      | 14 ms           | 109 ms | 0%     | —           |
| 50       | 126      | 18 ms           | 240 ms | 0%     | confere     |

A conferência rodou depois da rodada de 50 (3.161 ordens, 2.127 negócios no banco): dinheiro, ações
dos três ativos e reservas batem, e nada ficou negativo.

**RNF-02:** com 50 conexões observando (`node load-tests/tempo-real.mjs 50 25`) e 50 usuários
enviando ordens (~124 ordens/s), chegaram 99.550 eventos `NEGOCIO`: p50 de 7 ms, p95 de 12 ms e
máximo de 97 ms, contra o limite de 1 s no p95. O atraso é medido a partir do horário do
negócio no banco, então inclui a gravação, a publicação no Redis e o repasse pelo Gateway.

Durante a carga, o Prometheus (`http://localhost:9090`) mostra as mesmas grandezas pelo lado do
servidor; as consultas prontas estão no topo de `infra/prometheus/prometheus.yml`. Na rodada de 20
usuários, `histogram_quantile` deu p95 de 19 ms, coerente com o k6.

**Falta para o CA-04:** rodar na máquina da demo, registrar CPU e memória (`docker stats` ou as
métricas `bolsa_gateway_process_*`) e repetir o RNF-02 com os Home Brokers em outras máquinas.
