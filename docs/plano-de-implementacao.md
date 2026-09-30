# Plano de Implementação — Simulador de Bolsa de Valores Multiplayer

> Baseado em: `requirements.md` (v1.0, 30/09/2026), `system_design.md` (rascunho, 30/09/2026), `simulador-bolsa.dbml` + `simulador-bolsa-modelo-explicado.md`, `software_architecture_and_patterns.md` (rascunho)
> Status: Rascunho (rev. 2: equipe de 4 pessoas) — Data: 30/09/2026
> Capacidade assumida: **4 pessoas, ~10h/semana cada (≈ 40h/semana no total)**, sendo **2 no Motor em Rust**. O número de pessoas foi informado pelo grupo em 30/09/2026. As horas por pessoa são suposição (valor da rev. 1): confirmar.
> Datas fixas (SRS §2.4): **Parte 1 em 21/10/2026** e **entrega final em 30/11/2026**. O **Dia 0 é 01/10/2026**.

## 0. Resumo em linguagem simples

O trabalho é dividido entre 4 pessoas com áreas que quase não se cruzam: **Plataforma e Gateway** (Dev 1), **a fila e a casca do Motor** (Dev 2), **o núcleo do Motor, onde está a regra do dinheiro** (Dev 3), e **login e Home Broker** (Dev 4). O único ponto que trava todo mundo é a infraestrutura básica: repositório, banco rodando e formato das mensagens. Por isso o Dev 1 dedica o dia 01/10 a ela, enquanto os outros três já trabalham em partes que não dependem disso. A partir de 02/10, cada pessoa trabalha contra o **contrato de mensagens** combinado no Dia 0 e usa dados de exemplo (*fixtures*) no lugar das peças que ainda não existem. Não há espera entre as pessoas. O protótipo da Parte 1 (21/10) continua sendo a primeira fatia. O núcleo do dinheiro (o maior risco) começa no primeiro dia, em paralelo. Antes de programar, falta uma pendência externa: o professor confirmar que bibliotecas não contam como "código de terceiros" (SD-02).

## 1. Primeira Fatia Vertical (F1) — Protótipo da Parte 1

- **O que entra:** migrações completas (schema, ativos, papéis de banco); `packages/contracts` v0; Motor mínimo (consome o stream, confere o ativo, grava a ordem `ABERTA`, publica e dá `XACK`, sem casar nem reservar, conforme SD-06 b); Gateway com `auth`, `ordens`, `mercado`, `carteira` e `realtime` na versão P1; Home Broker com login, cadastro e painel; tudo sobe com `docker compose up`.
- **Riscos que derruba:** o contrato TS ⇄ Rust (T-14); a sequência única via Redis Stream e a espera assíncrona do `POST /ordens`; a regra "só o Motor escreve dinheiro", garantida pelo banco; o WebSocket com autenticação e presença; e o risco do Rust (SD-06).
- **Por que esta e não outra:** a Parte 1 tem data fixa e exige esse fluxo (CA-01). O maior risco de negócio, o casamento de ordens (F2), **não espera a F1**. Com 4 pessoas, o Dev 3 começa o núcleo do Motor no Dia 0, porque ele é código puro e não depende de infraestrutura.
- **Ponto de controle interno (10/10/2026):** ordem via `curl` com token ponta a ponta (Gateway → stream → Motor → Postgres → resposta).
- **Termina quando:** CA-01 é demonstrado com `docker compose up`, e T-12, T-13 e T-14 passam.

## 2. Papéis e Posse dos Módulos

| Pessoa | Papel | Módulos que são dela (do começo ao fim) | Por quê |
|---|---|---|---|
| **Dev 1** | Plataforma + Gateway | raiz (compose, workspace, README), `db`, `gateway/common`, `config`, `database`, `observability`, `ordens`, `mercado`, `realtime`, `infra/prometheus`, `load-tests` | Quem monta a infra conhece o compose, o banco e a borda, e depois fecha a medição de carga, que depende de tudo isso |
| **Dev 2** | A fila e a casca do Motor (Rust + um módulo TS) | `engine/main`, `config`, `contract`, `bus`, `store`, `processor`, `telemetry`; **também `gateway/bus`** | Os dois lados do Redis (quem escreve e quem lê o stream, quem publica e quem assina) ficam com a mesma pessoa, o que elimina a principal fonte de desencontro entre as linguagens. *Premissa: o Dev 2 também escreve TS.* |
| **Dev 3** | Núcleo do Motor (Rust puro) → Agentes | `engine/domain` inteiro; depois `agents` | O domínio é o caminho crítico e não depende de nada. Começa no Dia 0. Quem escreveu as regras do mercado é quem melhor escreve as estratégias dos agentes |
| **Dev 4** | Autenticação + Home Broker | `gateway/auth` (+ seed), `gateway/carteira`, `web` inteiro | Tudo o que o usuário vê e o login que todos precisam. Também é o contato com o professor (SD-02, Q-01, Q-02) |

**Mudanças em `packages/contracts`:** qualquer pessoa pode propor. O PR precisa de revisão de alguém da outra linguagem (Dev 2 ou 3 × Dev 1 ou 4) e só entra com T-14 passando (regra 3.3.8 da arquitetura).
**Pares de revisão de PR:** Dev 2 ⇄ Dev 3 (Rust) e Dev 1 ⇄ Dev 4 (TS).

## 3. Dia 0 — 01/10/2026: desbloquear os quatro

### 3.1 Início do dia: reunião de 1h com os quatro

Pauta fechada. Só se decide o que, se ficar indefinido, faria duas pessoas escreverem coisas incompatíveis:
1. **Mensagens do stream `orders`:** comando `CRIAR` (`clientOrderId`, `investidorId` vindo do JWT, `ativo`, `lado`, `quantidade`, `preco` em string) e `CANCELAR` (`clientOrderId`, `investidorId`, `ordemId`).
2. **Resultado da ordem** (Pub/Sub): a ordem com `status`, `motivoRejeicao`, execuções e `clientOrderId` para correlação.
3. **Eventos de mercado** (Pub/Sub → WS): `SNAPSHOT`, `ORDEM_ATUALIZADA`, `NEGOCIO`, `PRECO`, `LIVRO`, `PRESENCA`, `ERRO`. Os campos de `LIVRO` podem ficar para F4.
4. **Nomes no Redis:** stream `orders`, grupo de consumo `engine`, canais Pub/Sub, chave de presença com TTL de 10 s e chave de heartbeat do Motor.
5. **Rotas REST da P1:** `POST /auth/cadastro`, `POST /auth/login`, `POST /ordens`, `GET /mercado`, `GET /carteira`, e o formato de erro da arquitetura §4.2.
6. **Assinatura do domínio (Dev 2 × Dev 3):** o que a casca entrega ao núcleo (livro, conta e posições do investidor, comando) e o que recebe de volta (`Result<Resultado, Rejeicao>`).

### 3.2 O que cada pessoa faz no Dia 0

| Pessoa | Tarefa | Entrega do dia |
|---|---|---|
| **Dev 1** | **(1) Esqueleto do monorepo:** `pnpm-workspace.yaml`; `apps/gateway` (Nest vazio), `apps/web` (Next com `output: 'export'`), `apps/agents`, `apps/engine` (`cargo new`), `packages/contracts`; `tsconfig` estrito, ESLint, Prettier, rustfmt e clippy na raiz; `.env.example`; `.gitignore`. **Fazer o push disso primeiro, antes de qualquer outra coisa.** **(2) Banco rodando:** `docker-compose.yml` com Postgres 16 e Redis 7; `db/init` (papéis `engine_app` e `gateway_app`); `db/migrations/0001_schema.sql` (do DBML), `0002_ativos.sql` (Apêndice B), `0003_grants.sql`; `engine/main.rs` **só com `sqlx::migrate!` e saída** (o Dev 2 expande depois). **(3)** README com "como rodar" e integração dos PRs de contrato do dia | Qualquer pessoa consegue rodar `git clone` → `cp .env.example .env` → `docker compose up`, e o banco sobe com tabelas, 3 ativos e papéis; `pnpm -r test` e `cargo test` rodam (vazios, passando) |
| **Dev 2** | JSON Schemas do **comando** e do **resultado** + fixtures válidas e inválidas; structs serde em `engine/contract`; lado Rust do T-14 | Schemas do lado do Motor em PR |
| **Dev 3** | `engine/domain`: `dinheiro.rs` (Preco, Dinheiro, Quantidade com validação), `ordem.rs`, início de `livro.rs`, com testes unitários. Não depende de nada do Dev 1: trabalha num crate local até o esqueleto chegar ao repositório | Tipos do domínio com testes |
| **Dev 4** | JSON Schemas de **eventos de mercado** e **API REST** da P1 + fixtures; `dinheiro.ts`; constantes de `stage` do RF-025; lado TS do T-14 (ajv). **Enviar hoje ao professor** a pergunta SD-02/AP-04 e a lista de integrantes (Q-01) | Schemas do lado da tela em PR; e-mail ao professor enviado |

**Critério de "desbloqueado" (fim do Dia 0):** o esqueleto e o banco do Dev 1 estão na `main` e `packages/contracts` v0 está integrado com fixtures. A partir disso, ninguém precisa esperar ninguém até o ponto de controle de 10/10.

**Fica fora do Dia 0 de propósito** (cada dono faz na primeira semana): o `Dockerfile` de cada app e a entrada dele no compose, Prometheus, seed de usuários (depende do argon2 do `auth`).

### 3.3 Como cada pessoa trabalha sem esperar a outra (até 10/10)

| Quem | Precisa de algo que ainda não existe | Substituto até lá |
|---|---|---|
| Dev 1 (`ordens`) | O Motor respondendo | Publica uma fixture de resultado com `redis-cli PUBLISH` |
| Dev 2 (`engine`) | O Gateway enviando ordens | Envia com `redis-cli XADD` usando as fixtures de comando |
| Dev 2 (`processor`) | O domínio do Dev 3 | Implementa a casca contra um domínio falso que aceita tudo (a assinatura já foi combinada no Dia 0) |
| Dev 4 (`web`) | Gateway e WS | Cliente falso que devolve as fixtures; o reducer é testado só com fixtures |
| Dev 3 (`domain`) | — | Nada: é código puro |
| Todos | Usuário logado | `auth` é a **primeira** tarefa do Dev 4 (até ~08/10). Até lá, os testes de integração inserem investidores direto no banco |

## 4. Plano de Ação por Pessoa

Janelas-alvo com premissa de 10h/semana por pessoa, a recalibrar em 21/10 (§8). A ordem dentro de cada coluna é a ordem de execução.

### F1 — até 21/10/2026 (Parte 1)

| Dev 1 | Dev 2 | Dev 3 | Dev 4 |
|---|---|---|---|
| Dia 0 (§3) | Dia 0 (§3) | Dia 0 (§3) | Dia 0 (§3) |
| `gateway` base: `common`, `config`, `database`, logger pino com redact | `engine` casca: `config`, `bus` (consumidor + publicador), `store` (grava ordem `ABERTA`), `processor` mínimo, logs `tracing` com stages | `domain`: `livro.rs` (BTreeMap + VecDeque, desempate por `id`) | **`gateway/auth` + seed** (argon2, JWT, guard REST/WS) → **T-12** |
| `gateway/ordens` POST (DTOs, espera de 3 s) → **T-13** | `gateway/bus` (XADD, assinatura, correlação por `clientOrderId`) | `domain`: `casamento.rs` → **T-01, T-03** | `gateway/carteira` P1 (saldo e posições) |
| **10/10: ponto de controle com Dev 2 e Dev 4** | **10/10: ponto de controle** | `domain`: `conta.rs` (reservas, preço médio) → **T-02, T-04** | `web`: login, cadastro, painel, reducer, cliente WS |
| `gateway/mercado` P1 + `gateway/realtime` (WS autenticado, presença, repasse de eventos) | Dockerfile do engine, `restart: unless-stopped`; **T-14** no CI | `resultado.rs`, rejeições | Dockerfile do web; ensaio da demo CA-01 |
| **21/10: Parte 1** | | | **21/10: Parte 1** |

### F2 — alvo: fechar até ~04/11/2026

| Dev 1 | Dev 2 | Dev 3 | Dev 4 |
|---|---|---|---|
| `gateway/ordens` GET status (RF-011); começar a parte de consulta do **T-10** | `processor` real: BEGIN → domínio → COMMIT → `livro.aplicar` → PUBLISH → XACK → **T-06**; idempotência → **T-08** | **T-05** (proptest, só ordens); integrar o domínio real com o Dev 2 | `web`: status das ordens, negócios, saldo atualizado ao vivo |
| Logs com todos os stages do RF-025 no Gateway | Logs com todos os stages do RF-025 no Motor | Preço, variação e volume do ativo (RF-017) no `Resultado` | `gateway/carteira`: preço médio e P/L no SQL (RF-005 P2) |

### F3 + F4 — alvo: fechar até ~18/11/2026

| Dev 1 | Dev 2 | Dev 3 | Dev 4 |
|---|---|---|---|
| `realtime`: snapshot na reconexão (RF-004), detecção de desconexão (RF-023) | **F3:** recuperação do livro a partir do Postgres → **T-07**; descarte por idade → **T-09**; heartbeat | **F4:** cancelamento no domínio → **T-11**; T-05 passa a gerar cancelamentos | **F3:** `web` reconexão a cada ≤ 5 s e aviso de "desconectado" (RNF-11) |
| **F4:** `DELETE /ordens` (RF-012), fechar **T-10**; `mercado` P2 (volume, melhores ofertas, top-5 do livro) | Cancelamento no `processor`; roteiro da demo de falha CA-05 em `docs/` (1º ensaio) | **F5:** `agents` cliente REST/WS + estratégia conservadora | **F4:** `web` histórico (RF-008), livro (RF-007), botão de cancelar |
| **Antecipar:** esqueleto do k6 contra a API da P1 (valida D-03 cedo) | | **F5:** estratégia agressiva (RF-020); ≥ 5 agentes no compose (RF-019, Q-03) | `gateway/carteira`: histórico de ordens e negócios |

### F6 — 18/11 a 25/11/2026; congelamento em 26/11

| Dev 1 | Dev 2 | Dev 3 | Dev 4 |
|---|---|---|---|
| Métricas no Gateway (RF-026), `infra/prometheus` | Métricas no Motor (RF-026) | **T-15** (SQL de conferência + k6 com Dev 1) | README final, diagramas, checklist **CA-06** |
| k6 com 5, 20 e 50 usuários (RNF-04) | 2º ensaio da demo de falha com o sistema carregado | **T-16** (cenário do §6 do PDF + filtro de log) | Consolidar o relatório de carga (CA-04) |
| *Se sobrar:* Grafana (RF-027) | | *Se sobrar:* eventos econômicos (RF-021) | Checklist manual de telas |

**26/11 a 30/11/2026:** congelamento. Só entra correção de bug. Ensaio geral da apresentação com os quatro.

### Carga estimada até 21/10 (conferência de equilíbrio)

| Pessoa | Tarefas até 21/10 | Estimativa | Capacidade (Dia 0 + 3 semanas) |
|---|---|---|---|
| Dev 1 | Dia 0, gateway base, ordens, mercado, realtime | 27–36h | ~30–38h, **no limite** |
| Dev 2 | Schemas, contract, casca do engine, `gateway/bus` | 23–34h | ~30–38h |
| Dev 3 | Domínio até T-04 (trabalho de F2 adiantado) | 25–35h | ~30–38h |
| Dev 4 | Schemas, auth, carteira P1, web P1 | 25–34h | ~30–38h |

Se o Dev 1 atrasar, `gateway/realtime` passa para o Dev 2, que conhece o lado de assinatura do Redis. O Dev 1 não deve deixar a infra ou o `ordens` para trás, porque eles bloqueiam os outros.

## 5. Mapa RF × Fatia

| Fatia | Objetivo | RF que fecham nela | Donos principais | Estimativa (grupo) |
|---|---|---|---|---|
| **F1** | Protótipo ponta a ponta (CA-01) | RF-001, RF-002, RF-003 (e a parte P1 de RF-005, RF-006, RF-009, RF-010, RF-018) | Todos | 60–90h |
| **F2** | Casamento, reservas, liquidação atômica | RF-009, RF-010, RF-011, RF-013, RF-014, RF-015, RF-016, RF-017, RF-025 | Dev 2 e Dev 3 | 40–60h (grande parte já adiantada em F1 pelo Dev 3) |
| **F3** | Falha e recuperação (CA-05) | RF-004, RF-022, RF-023, RF-024 | Dev 2, Dev 1, Dev 4 | 20–35h |
| **F4** | Home Broker completo | RF-005, RF-006, RF-007, RF-008, RF-012, RF-018 | Dev 4, Dev 1, Dev 3 | 25–40h |
| **F5** | Agentes | RF-019, RF-020 | Dev 3 | 15–25h |
| **F6** | Métricas, carga e fechamento | RF-026 | Todos | 20–35h |
| **Adiados** | — | RF-021 (Could), RF-027 (Could) | Dev 3 e Dev 1 | Candidatos se M7 fechar até 18/11 |

**Conferência:** 27 RF no SRS = 25 atribuídos (F1: 3, F2: 9, F3: 4, F4: 6, F5: 2, F6: 1) + 2 adiados. Órfãos: nenhum.

**RNF e CA:** RNF-06, RNF-07, RNF-09 e RNF-10 → F1 · RNF-01 e RNF-05 → F2 · RNF-08 → F2 e F4 · RNF-11 → F3 · RNF-02, RNF-03 e RNF-04 → medição em F6 · RNF-12 → contínuo · RNF-13 → atendido pela topologia · RNF-14 → adiado. CA-01 → F1 · CA-05 → F3 (ensaio em F6) · CA-02, CA-03, CA-04 e CA-06 → F6.

**Conta de capacidade:** de 01/10 a 25/11 são cerca de 8 semanas, ou ~320h. F1 a F6 somam 180 a 285h, mais 10 a 15% de coordenação e revisão. **Cabe**, com folga para os dois Could. A ordem de corte continua valendo se a recalibração de 21/10 mostrar outra coisa: RF-007 → RF-020 → RF-012.

## 6. Provas Obrigatórias por Fatia

| Prova | O que prova | Fatia | Dono |
|---|---|---|---|
| T-14 | Contrato idêntico em TS e Rust | F1 | Dev 2 (Rust) + Dev 4 (TS) |
| T-12 | Hash argon2, 401, REST/WS sem token recusados | F1 | Dev 4 |
| T-13 | Entradas inválidas → 400 e nada no stream | F1 | Dev 1 |
| T-01, T-02, T-03, T-04 | Exemplo do PDF, preço melhor, desempate por `id`, saldo insuficiente | F2 (escritos já em F1) | Dev 3 |
| T-05 | Conservação por propriedade (ganha cancelamentos em F4) | F2 (+F4) | Dev 3 |
| T-06 | Falha no meio da gravação → nada muda | F2 | Dev 2 |
| T-08 | Idempotência por `clientOrderId` | F2 | Dev 2 |
| T-07 | Livro reconstruído idêntico | F3 | Dev 2 |
| T-09 | Comando vencido descartado | F3 | Dev 2 |
| T-10 | Isolamento entre investidores | F4 | Dev 1 |
| T-11 | Cancelamento parcial devolve a reserva exata | F4 | Dev 3 (unit) + Dev 2 (integração) |
| T-15 | Concorrência com totais conservados (CA-03) | F6 | Dev 3 + Dev 1 |
| T-16 | Cenário do §6 do PDF com logs completos (CA-02) | F6 | Dev 3 |

## 7. Marcos e Dependências Externas

| Marco | Evento | Depende de (externo) | Trava |
|---|---|---|---|
| **M0** | Dia 0 fechado: infra e contrato v0 na `main` (01/10) | D-02 (repositório criado) | O trabalho paralelo dos 4 |
| M0b | Professor responde SD-02/AP-04 | **SD-02** | A stack. Uma resposta negativa obriga a replanejar tudo. Enviado no Dia 0 |
| M1 | Ordem ponta a ponta via `curl` (10/10) | — | Confiança na P1 |
| **M2** | **Parte 1 entregue (21/10)** | Q-01, Q-02 | Nota da Parte 1 |
| M3 | Retorno do professor sobre as regras de mercado | D-01 | Replanejar F2 se houver mudança |
| M4 | F2 fechada: negócio real entre dois humanos (~04/11) | — | F3, F4, F5 |
| M5 | Primeiro k6 com 5 usuários na máquina da demo | **D-03** | Descobrir cedo se a máquina aguenta |
| M6 | F3 + F4 + F5 fechadas (~18/11) | Q-03 | F6 |
| M7 | F6 fechada; congelamento (26/11) | — | Entrega |
| **M8** | **Entrega e apresentação final (30/11)** | — | — |

> Disparar já, pelo Dev 4 no Dia 0: pergunta SD-02/AP-04 ao professor, lista de integrantes (Q-01) e confirmação dos valores de S-01 (Q-02). Pelo Dev 1: repositório criado e compartilhado com o professor (D-02).

## 8. Critério de Replanejamento

Revisar este plano quando:
- **21/10/2026:** cada pessoa compara as horas gastas com a estimativa da §4. Recalibrar as janelas de F2 a F6 e, se preciso, aplicar a ordem de corte.
- **O ponto de controle de 10/10 falhar:** redistribuir antes de insistir (ex.: `realtime` para o Dev 2) e reavaliar SD-06 c.
- Alguém do grupo sair ou a capacidade de alguém cair: os módulos dessa pessoa são redistribuídos pela §2, sempre mantendo os dois lados do Redis com uma só pessoa.
- O professor responder **não** a SD-02 ou mudar as regras de mercado (D-01).
- Entrar um novo RF `Must` ou mudar a prioridade de RF-007, RF-012 ou RF-020.
- O primeiro k6 (M5) mostrar RNF-02 ou RNF-03 fora do alvo.
