# Validação do DIV 3 — 25/10/2026

Base: `main` em `35f36d8`, com alterações locais do DIV 3 ainda sem commit.
Escopo: domínio, ciclo dos agentes e cenário multiplayer T-16. Nenhuma alteração
no Gateway, banco, contratos, Compose ou interface.

## Resultado

- Domínio: 10 testes passaram, incluindo proptest de ordens e cancelamentos.
- Biblioteca Rust: 9 testes passaram; contrato Rust: 2 testes passaram.
- Agentes: 33 testes passaram (23 de estratégias, 8 de ciclo e 2 de cliente).
- Cobertura do domínio: 372/376 linhas instrumentadas, **98,94%**. A meta interna
  é 90% das linhas, não dos ramos. O resultado não mede a casca de I/O.
- T-16: três investidores enviaram ordens concorrentes pelo Gateway real;
  matching, saldo, ações, mercado, livro, histórico e notificações conferiram.
- RF-025: logs reais das três ordens contiveram todas as etapas exigidas.
- Sessão: com JWT de 5 segundos na instância isolada, os cinco agentes receberam
  `401`, refizeram login e enviaram novas ordens. No recorte registrado, cada um
  fez entre 6 e 7 logins, com ordens enviadas após a primeira recuperação.

Os números são um registro desta execução, não uma promessa para qualquer
ambiente. Os testes de ciclo usam relógio e transporte simulados; o ensaio com
JWT curto complementou-os usando os serviços reais.

## Reexecutar os testes do DIV 3

Na raiz do repositório, com Node >= 24.9, pnpm 10.4.1 e Rust estável:

```bash
pnpm --filter @bolsa/agents test
pnpm --filter @bolsa/agents typecheck
pnpm lint
pnpm format:check
cargo test -p engine --lib --test domain --test contrato
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
```

## Medir cobertura

Ferramentas usadas: `cargo-llvm-cov` 0.9.1 e `llvm-tools-preview`. A instalação
feita nesta máquina usa `/tmp/div3-coverage-tools`, sem dependência no Cargo.toml.
Para instalar no caminho padrão do Cargo em outra máquina:

```bash
cargo install cargo-llvm-cov --version 0.9.1 --locked
rustup component add llvm-tools-preview
```

Nesta máquina, acrescente `/tmp/div3-coverage-tools/bin` ao PATH do comando:

```bash
PATH="/tmp/div3-coverage-tools/bin:$PATH" cargo llvm-cov \
  --test domain \
  --ignore-filename-regex '(/tests/|/build.rs|/src/(bus|config|contract|main|processor|store|telemetry))' \
  --fail-under-lines 90
```

O filtro exclui testes, build script e módulos fora de `engine/domain`. O relatório
deve conter os seis arquivos `casamento`, `conta`, `dinheiro`, `livro`, `ordem` e
`resultado`. Não confundir linhas com regiões ou ramos. O proptest gera sequências
aleatórias e pode modificar um pouco a porcentagem entre execuções.

## T-16 / CA-02 — João, Maria e Pedro

O script exige uma instância exclusiva, sem agentes nem outros clientes e com
livro de ABC3 vazio. Se o livro estiver ocupado, ele recusa executar antes de
cadastrar usuários. Não limpa ordens ou dados de terceiros. Cada execução cria
três investidores novos e preserva seu histórico para inspeção.

O exemplo abaixo usa outro projeto Compose e outras portas, sem trocar o `.env`
nem afetar o projeto principal. Execute em bash na raiz do repositório, com as
portas indicadas livres. Espere o Gateway concluir a inicialização antes do Node.

```bash
(
  export COMPOSE_PROJECT_NAME=bolsa-div3-t16
  export POSTGRES_PORT=55433 REDIS_PORT=6380 GATEWAY_PORT=3002
  docker compose up -d --build postgres redis engine gateway

  # Quando GET http://localhost:3002/mercado responder:
  GATEWAY=http://localhost:3002 node load-tests/cenario-multiplayer.mjs > /tmp/t16-resultado.json
  cat /tmp/t16-resultado.json
  docker compose logs --no-log-prefix engine gateway > /tmp/t16-logs.jsonl
  node load-tests/rastro-multiplayer.mjs /tmp/t16-resultado.json /tmp/t16-logs.jsonl

  docker compose stop
)
```

João compra 10, Maria compra 20 e Pedro vende 30 ações de ABC3, todos a R$ 25,00.
Os três pedidos são disparados com `Promise.all`: o teste aceita qualquer ordem
de chegada definida pelo servidor. No ensaio, os IDs foram João=1, Pedro=2 e
Maria=3. Os compradores receberam 10 e 20 ações; Pedro entregou 30. Os saldos
variaram em -R$ 250, -R$ 500 e +R$ 750, sem reservas restantes. O volume cresceu
30 e o livro terminou vazio.

O rastro correlaciona `orderId` e `clientOrderId`, sem depender do relógio dos
clientes. Confere recebimento, validação, inserção **ou** matching, atualização
da carteira e publicação por ordem; no conjunto exige também trade e todas as
etapas do RF-025. Uma ordem totalmente executada na chegada não é inserida no
livro. A entrega efetiva das notificações aos três clientes é conferida pelos
WebSockets no script do cenário, não apenas pelo log `CLIENTS_NOTIFIED`.

## Ensaio real de expiração dos agentes

Em instância isolada, ajuste a validade só pelo ambiente do Compose; não troque
a configuração do localhost principal. Use projeto exclusivo e portas livres:

```bash
(
  export COMPOSE_PROJECT_NAME=bolsa-div3-sessao
  export POSTGRES_PORT=55433 REDIS_PORT=6380 GATEWAY_PORT=3002
  export JWT_EXPIRACAO=5s
  docker compose up -d --build postgres redis engine gateway agents
  docker compose logs -f agents
  # Observe pelo menos 30 s: 401 → novo "agente conectado" → nova "ordem enviada".
  # Ctrl+C encerra somente o acompanhamento dos logs.
  docker compose stop
)
```

Não basta contar logins: confira novas ordens **após** a recuperação de cada um
dos cinco agentes. JWT de 5 segundos é somente para este ensaio, nunca a
configuração recomendada da demonstração. As instâncias de teste podem ser
paradas sem apagar seus volumes; nenhum comando acima usa `down -v`.

## Fechamento que continua conjunto

T-15/CA-03, carga de 5/20/50 usuários na máquina da apresentação, CPU/memória,
sobrecarga e ensaio de falha continuam com Dev 1/Dev 2 e o grupo. O T-16 usa
três clientes e não substitui carga. Os problemas de Nginx e leitura consistente
da carteira permanecem com os responsáveis por web/Gateway.
