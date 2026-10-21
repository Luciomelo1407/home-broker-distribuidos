# Revisão e complementos do Dev 4 — 21/10/2026

## Base examinada

O ZIP recebido contém o monorepositório completo para esta revisão: `apps/gateway`, `apps/web`,
`apps/engine`, `apps/agents`, contratos e fixtures, migrações, Compose, CI e os documentos de
requisitos, arquitetura, plano e integração. Não faltou outro repositório para trabalhar na parte
do Dev 4. O `.env.example` está presente; `.env` real, dependências instaladas e histórico/branches
Git normalmente não fazem parte de um ZIP do GitHub.

O README e `docs/integracao.md` registram que o Dev 1 já havia implementado autenticação, seed,
carteira e interface P1/P2. Esse trabalho foi preservado e revisado. Os complementos abaixo partem
dessa implementação real; não transportam o serviço fictício do laboratório anterior para o projeto.

## Alterações realizadas

| Área | Correção/complemento |
| --- | --- |
| Envio de ordens | Preserva UUID e corpo completo após resultado incerto, bloqueia mudança dos campos e clique repetido e permite repetição manual idempotente da mesma solicitação |
| Recuperação da intenção | Salva a tentativa em `sessionStorage`, isolada por investidor/aba; restaura após F5 e remove após confirmação ou recusa definitiva; armazenamento bloqueado mantém proteção apenas em memória |
| HTTP na rede local | UUID v4 com `crypto.getRandomValues`, sem depender de `randomUUID` em contexto seguro |
| REST | Timeout de 10 s, consultas sem cache, identificação de resposta inválida e verificação da ordem/identificador devolvidos |
| Cancelamento | Resultado incerto fica explícito; consulta `GET /ordens/:id` antes de outra tentativa; nenhum cancelamento é reenviado automaticamente |
| Confirmação do cancelamento | Consulta de status também recarrega carteira e histórico; evento terminal prevalece sobre resposta ou falha tardia da consulta |
| Reconexão | WebSocket aberto ainda aguarda `SNAPSHOT` antes de liberar operações; desconexão e Motor indisponível pausam novos comandos |
| Estado da tela | Respostas antigas de REST não sobrescrevem consulta posterior nem sobrevivem à saída/troca de sessão; execução/estado terminal da ordem não regride por resposta atrasada |
| Carteira/histórico | Falhas de atualização ficam visíveis, com nova tentativa; cadastro/login já concluídos não são repetidos indevidamente |
| Sessão | Valida o formato armazenado, limpa a tela imediatamente ao sair e acompanha saída/troca de conta feita em outra aba |
| Leituras do banco | Carteira e histórico usam transações somente leitura com snapshot repetível; nenhum schema ou regra financeira do Motor foi alterado |
| Horários | Histórico serializa o horário em UTC antes de acrescentar `Z` |
| Autenticação | JWT só aceita `sub` inteiro positivo seguro; testes reais de Argon2/JWT cobrem credenciais, assinatura, expiração e identidade inválida |
| Acesso por teclado | Preços do livro e seleção de ativos têm botões acessíveis, em vez de depender só do clique na linha |

O seed foi revisado: usa o hash Argon2 do cadastro, transação para investidor/posições e conflito de
nome para preservar agentes já existentes. A implementação do seed não precisou de alteração.

### Ajuste compartilhado necessário para validar

A política de dependências deste ambiente recusou `@opentelemetry/api@1.10.0` por publicação recente.
Foi fixada a versão compatível `1.9.0` em `pnpm-workspace.yaml`, com sua integridade do registro no
lockfile. As demais versões originais do lockfile foram preservadas, incluindo Next `16.3.8`.
Os pós-install de `@parcel/watcher` e `unrs-resolver` foram explicitamente negados (`allowBuilds:
false`); a instalação e os builds funcionaram com os binários já distribuídos. Nenhuma política de
idade mínima ou integridade foi desativada. Por serem arquivos da raiz, essas duas mudanças devem
ser revisadas também pelo Dev 1.

Na preparação para o PR foram adicionadas apenas dependências de desenvolvimento do `web`:
`@testing-library/react@16.3.0`, `@testing-library/dom@10.4.1` e `jsdom@26.1.0`. Elas permitem
testar componentes e hooks sem serviços externos. O pnpm atualizou as relações de peers no
lockfile; nenhuma versão de pacote já presente foi removida ou atualizada. A nova instalação com
`--frozen-lockfile` também passou.

## Verificações executadas nesta revisão

Ambiente: Linux x86-64, Node `24.19.0`, pnpm `11.25.0` disponível no ambiente. O campo
`packageManager` original (`pnpm@10.4.1`) foi preservado.

| Verificação | Resultado |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passou, incluindo a política de dependências |
| `pnpm -r typecheck` | Passou nos quatro pacotes TypeScript |
| `pnpm -r test` | 284 testes passaram: contratos 59; agentes 16; web 93; Gateway 116 |
| `pnpm lint` | Passou |
| `pnpm format:check` | Passou |
| `pnpm --filter @bolsa/web build` | Passou; exportação estática de início, cadastro, login e painel |
| `pnpm --filter @bolsa/gateway build` | Passou |

O build final do web passou com cache novo. Uma tentativa anterior parou por erro interno do
Turbopack ao ler o cache local; esse cache foi movido para fora do projeto, sem alterar código ou
versões para contornar a falha.

Os testes novos exercitam repetição/identidade da ordem, restauração após F5, clique concorrente,
resposta atrasada, perda de sessão, timeout, resposta inválida, snapshot/reconexão, Argon2/JWT e o
uso/rollback da transação de leitura. Os testes do banco nesta revisão usam cliente controlado;
não substituem testes concorrentes contra Postgres real.

### Complementos antes do PR

Foram acrescentados 53 testes aos 231 da revisão anterior. A cobertura nova inclui os formulários
React, componentes de ordens/mercado/livro, ciclo do hook do painel, navegação de sessão e URL do
Gateway na LAN. Os testes de interface usam DOM simulado (jsdom), com transporte controlado;
não avaliam aparência, layout, foco ou comportamento completo de um navegador real.

O teste `auth.http.spec.ts` sobe os módulos reais de auth/carteira/common e percorre HTTP,
validação de DTO, guard global, Argon2, JWT e transações do `DatabaseService`, substituindo apenas
o pool do Postgres. Verifica credenciais incorretas, tokens inválidos, campos de identidade/saldo
indevidos no cadastro, rollback e identidade das consultas. `seed-agentes.spec.ts` cobre perfis,
hash, preservação de contas existentes e rollback. O pool controlado não comprova a execução dos
SQLs, grants, triggers ou isolamento concorrente no Postgres real.

Os novos testes reproduziram duas falhas antes da correção: uma consulta atrasada de cancelamento
voltava a mostrar "ordem aberta" após confirmação por evento; e confirmar o status via GET não
recarregava as reservas/carteira. Ambos os cenários passaram depois das correções.

A descrição sugerida, a aplicação segura do patch e os critérios de merge estão em
[`pr-dev4.md`](pr-dev4.md). O patch foi conferido em uma extração limpa do ZIP original; o checkout
atual do grupo ainda precisa ser comparado, pois pode conter commits posteriores ao arquivo enviado.

## Verificações ainda pendentes no ambiente do grupo

Não foi possível executar Docker/Compose, Postgres, Redis ou Rust neste ambiente. Eles não estavam
disponíveis, e a instalação de serviços foi recusada pelas permissões do sistema. Também não houve
conferência visual/interativa em navegador. Portanto, esta revisão não certifica o sistema inteiro
como pronto para apresentação ou entrega final.

| Verificação restante | Onde está o roteiro/código |
| --- | --- |
| Compilar/testar o Motor e executar sua integração com o banco | README e `apps/engine/tests/processor.rs` |
| E2E do Gateway com Postgres, Redis e Motor | `apps/gateway/test/` e CI |
| Dois investidores operando e vendo negociações reais | Roteiro abaixo e CA-01/CA-02 |
| Reconexão e recuperação financeira após falha real | `docs/demo-falha.md` |
| Carga, latência e conservação de dinheiro/ações | `load-tests/README.md` |
| Uso por outro computador, responsividade e teclado | Home Broker executável e roteiro abaixo |
| Revisão dos módulos dos Devs 1, 2 e 3 e integração dos PRs | README e `docs/integracao.md` |
| Nomes dos integrantes e esclarecimentos com o professor | Responsabilidade do grupo/Dev 4; nenhuma mensagem foi enviada |

### Sequência para concluir a validação

1. Conferir o `.env` de desenvolvimento conforme `.env.example`, sem substituir credenciais
   locais já configuradas. Instalar as dependências com `pnpm install --frozen-lockfile`.
2. Subir `docker compose up --build`. Verificar Motor pronto, Gateway e Home Broker.
3. Abrir duas sessões independentes do navegador, cadastrar investidores diferentes e entrar.
   Confirmar que cada carteira/histórico pertence ao usuário correto.
4. Selecionar ativo e preço no livro; enviar ordens compatíveis de usuários diferentes. Conferir
   execução parcial/completa, reservas, saldo, patrimônio, P/L e histórico nos dois clientes.
5. Enviar ordem que permaneça aberta e cancelá-la. Confirmar estado e liberação de reservas pelo
   Motor. Tentar acesso/cancelamento da ordem do outro usuário: o servidor deve recusar.
6. Usar o navegador para desconectar um cliente. Conferir aviso, bloqueio de novos comandos e
   recuperação por snapshot ao reconectar. Não interpretar apenas socket aberto como sincronização.
7. Durante envio com falha de resposta, conferir que os campos e o identificador são preservados.
   Recarregar a página e observar a recuperação da tentativa. Qualquer repetição deve conservar
   exatamente a intenção original; não enviar ordens novas para tentar adivinhar o resultado.
8. Repetir a conferência para cancelamento incerto usando a consulta de status. O cliente não faz
   outro `DELETE` automaticamente.
9. Conferir saída/troca de conta em outra aba e sessão expirada. Dados privados não devem ficar na
   tela do usuário seguinte.
10. Rodar os e2e do Gateway, os testes Rust, carga e o roteiro de falha nos ambientes de teste
    apropriados. Esses testes escrevem dados: usar ambiente descartável separado da demonstração.
11. Conferir acesso ao Home Broker por IP de outra máquina, navegação por teclado e janela estreita.
12. Revisar o diff com o Dev 1 e registrar a contribuição real nos commits/PR. O ZIP não inclui o
    histórico Git e nenhum commit, PR ou envio ao professor foi realizado por esta revisão.

## Prompt injection

Não foram encontrados indícios de prompt injection nos arquivos examinados do ZIP, incluindo
documentação, configurações e CI. O PDF original também não apresentou esses indícios: a regra
acadêmica sobre autoria é texto visível do enunciado. O PDF tem uma ação de impressão em JavaScript,
identificada na revisão inicial; isso é comportamento do arquivo e não prompt injection.

## Limite de escopo

O código funcional alterado pertence a `gateway/auth`, `gateway/carteira` e `web`. Não houve alteração
no domínio/casca do Motor, agentes, banco/migrações, barramento, contratos ou realtime do Gateway.
Fora desses módulos, houve o ajuste de instalação em workspace/lockfile e a atualização documental.
As funcionalidades opcionais do grupo e a validação distribuída completa continuam seguindo o plano.
