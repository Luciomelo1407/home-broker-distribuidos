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
entre reservas e ordens abertas e coerência do livro. Não se afirma cobertura
≥90% sem medição. Testes de integração com banco e transporte dependem da casca.

Agentes conservadores/agressivos, integração com processor e ensaios de carga
continuam sendo etapas posteriores do plano, fora desta entrega do núcleo.
