# DIV 3 — Núcleo do Motor

Implementação em `apps/engine/src/domain`, exportada pela biblioteca `engine`.
Não utiliza async, banco, Redis, relógio, float ou geração de IDs.
`main.rs`, migrações e contratos de transporte permanecem sob responsabilidade do Dev 2.

## API de integração

A casca carrega um `Estado` consistente: contas dos investidores, posições,
ordens, livros por ativo e indicadores de mercado. IDs de ordem são atribuídos
pelo servidor/banco; nunca pelo cliente. O domínio recebe `Ordem::nova(...)`.
Para recuperação, `Ordem::restaurar` valida status e quantidade executada;
`Livro::inserir` reordena o nível por ID mesmo se as linhas vierem fora de ordem.

- `estado.criar(ordem) -> Result<Resultado, Rejeicao>`
- `estado.cancelar(investidor_id, ordem_id) -> Result<Resultado, Rejeicao>`

Ambas calculam uma proposta em cópia. `Resultado.estado` é o próximo snapshot;
`execucoes` contém os negócios (sem IDs/timestamps de persistência), e
`ordens_alteradas` identifica as ordens a gravar. A casca deve, sequencialmente:

1. Calcular a proposta contra o estado atual.
2. Persistir ordem, negócios, contas, posições e mercado na mesma transação.
3. Somente após COMMIT, substituir o estado em memória por `resultado.estado`.
4. Publicar eventos e confirmar a mensagem.

Descartar a proposta após rollback preserva integralmente o snapshot original.
Não reutilizar propostas contra um estado mais recente; o escritor é único.
A cópia integral prioriza correção nesta versão acadêmica; medir antes de
substituí-la por deltas. Idempotência, expiração de comandos e gravação de ordens
rejeitadas pertencem ao processor, assim como tradução dos enums para o contrato.
O domínio não fornece uma implementação de persistência nem prova T-06 de banco.

## Regras numéricas

Preço positivo com até duas casas; quantidade positiva até INTEGER_MAX;
saldos não negativos dentro de DECIMAL(15,2). Dinheiro permite zero porque
contas e reservas podem se esgotar; valores de ordens continuam estritamente
positivos. Entradas com frações de centavo são recusadas, sem arredondamento.
Preço médio considera ações disponíveis **e reservadas**, arredonda em quatro
casas com empate afastado de zero e zera quando a posição é encerrada.
Venda parcial não modifica o custo médio remanescente. Negócios executam
no preço da ordem passiva. Não foi acrescentada proibição de autonegociação,
pois os requisitos não a estabelecem.

Contas/posições de entrada são snapshots confiáveis da casca. A ausência de uma
conta necessária ou uma reserva incoerente resulta em EstadoInvalido/ValorInvalido;
a casca deve tratar isso como falha de invariante, e não rejeição comercial.

## Verificação

`cargo fmt --all --check`

`cargo clippy --all-targets -- -D warnings`

`cargo test`

`apps/engine/tests/domain.rs` cobre T-01, T-02, T-03, T-04, T-05 e T-11.
T-05 confere conservação de dinheiro e ações após cada comando, correspondência
entre reservas e ordens abertas e coerência do livro. Em 25/10/2026, a medição com
`cargo llvm-cov --test domain` cobriu 372 de 376 linhas instrumentadas do domínio
(98,94%), acima da meta interna de 90%. Isso não significa cobertura de todos os
caminhos de erro nem da casca. Comandos e escopo em
[`div3-validacao.md`](div3-validacao.md).

## Integração e agentes

O núcleo já está integrado ao `processor` do Dev 2, que aplica o estado apenas
depois do COMMIT. Os testes de integração com Postgres continuam na casca.

`apps/agents` contém os perfis conservador e agressivo e usa somente REST/WS do
Gateway. O conservador aguarda se não consegue oferecer preço positivo na faixa
de 1% sem cruzar o spread. Após `401`, o agente encerra a sessão antiga, refaz o
login e espera novo snapshot. A geração de sessão invalida callbacks antigos;
o novo ciclo espera a requisição anterior terminar. Requisições têm timeout de
5 segundos e ordens com resultado incerto não são reenviadas automaticamente.

O T-16 está em `load-tests/cenario-multiplayer.mjs`, com conferência de logs em
`load-tests/rastro-multiplayer.mjs`. Foi executado com três clientes contra uma
instância isolada. Essa prova não substitui T-15, carga de 5/20/50 usuários,
medição de recursos e ensaio de falha, que continuam sendo fechamento conjunto.
