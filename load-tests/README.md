# Testes de carga (k6)

Roteiros para o RNF-04 e o CA-04. Rodam com a imagem oficial do k6, sem instalar nada:

```bash
docker compose up -d --build            # sistema inteiro de pé
docker run --rm --network host -v "$PWD/load-tests:/scripts" grafana/k6 \
  run -e VUS=50 -e DURACAO=1m /scripts/ordens.js
docker compose exec -T postgres psql -U postgres -d bolsa < load-tests/conferencia.sql
```

| Arquivo           | O que faz                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ordens.js`       | `VUS` investidores novos enviando ordens limitadas aleatórias (±2% do preço inicial) pelo REST. Threshold do RNF-03: p95 ≤ 500 ms. |
| `conferencia.sql` | Conservação de dinheiro e ações, reservas iguais ao livro e nada negativo (base do T-15).                                          |

O `--network host` só funciona no Linux. No Mac/Windows, use `-e GATEWAY=http://host.docker.internal:3001`.

## Primeira medição (M5), 21/10/2026

Máquina de desenvolvimento do Dev 1, não a da demo (D-03 continua em aberto). Sistema inteiro no
compose, banco recém-criado, 20 s por rodada.

| Usuários | Ordens/s | Confirmação p95 | Máx.   | Falhas | Conferência |
| -------- | -------- | --------------- | ------ | ------ | ----------- |
| 5        | 14       | 14 ms           | 46 ms  | 0%     | —           |
| 50       | 126      | 18 ms           | 240 ms | 0%     | confere     |

A conferência rodou depois da rodada de 50 (3.161 ordens, 2.127 negócios no banco): dinheiro, ações
dos três ativos e reservas batem, e nada ficou negativo.

**Falta para o CA-04:** rodar na máquina da demo, medir CPU e memória (`docker stats`), o tempo de
um negócio chegar aos Home Brokers pelo WebSocket (RNF-02, ainda não medido), e a rodada de 20
usuários.
