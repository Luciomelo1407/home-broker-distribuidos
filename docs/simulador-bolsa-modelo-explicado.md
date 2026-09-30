# Modelo de dados — Simulador de Bolsa de Valores Multiplayer

> Baseado em: `requirements.md` (v1.0, 30/09/2026) e `system_design.md` (rascunho, 30/09/2026)
> Arquivo do modelo: `simulador-bolsa.dbml` — visualize colando em https://dbdiagram.io

## Visão geral

O modelo tem **5 tabelas** no PostgreSQL, a fonte da verdade definida no system design (§3). A entidade central é a **ordem**. O investidor envia ordens sobre um **ativo**. Quando duas ordens compatíveis se encontram, surge um **negócio**, que move dinheiro entre **investidores** e ações entre **posições** (a carteira).

Três coisas ficam **de fora do banco de propósito**, porque o system design as coloca no Redis ou em memória:
- **Sessões:** JWT sem estado (§5.5). Não existe tabela de sessões.
- **Presença de conectados (RF-003, RF-023):** chave com TTL no Redis. Não há histórico de conexões.
- **Fila de comandos e eventos:** Redis Stream e Pub/Sub.

Logs de ciclo da ordem (RF-025) e métricas (RF-026) vão para stdout e para o Prometheus, não para o banco.

## Tabelas

### investidores
- **O que representa:** qualquer participante do mercado, humano ou agente, com seu dinheiro.
- **De onde veio:** RF-001, RF-002, RF-005, RF-009, RF-019, RF-020, RNF-06.
- **Decisões não óbvias:**
  - **Humanos e agentes na mesma tabela**, diferenciados por `tipo`. O system design diz que os agentes "usam a mesma API dos humanos" e o RF-019 exige "as mesmas regras e validações". Tabelas separadas duplicariam a lógica de saldo e de ordens.
  - **O saldo fica no próprio investidor** (`saldo_disponivel` + `saldo_reservado`), não numa tabela de "contas". Existe uma única moeda e um único saldo por investidor, então uma tabela a mais não traria ganho.
  - **Saldo reservado separado do disponível:** implementa a reserva de RF-009 e §5.1 do system design. Ao aceitar uma compra, o Motor move o valor de uma coluna para a outra na mesma transação. Assim o valor bloqueado é visível e auditável, e não precisa ser recalculado.
  - `perfil` só é usado por agentes (RF-020).

### ativos
- **O que representa:** as ações virtuais negociáveis (ABC3, DEF4, GHI3).
- **De onde veio:** RF-006, RF-017, S-01, Apêndice B.
- **Decisões não óbvias:**
  - `preco_atual` e `volume_negociado` são **valores já calculados e guardados** (dados que também poderiam ser somados a partir de `negocios`). Isso atende o RF-017 ("após cada negociação, atualizar preço e volume") sem somar a tabela de negócios a cada consulta. O Motor atualiza os dois na mesma transação do negócio, então eles nunca divergem.
  - `preco_referencia` é a base da "variação desde o início da sessão do servidor" (RF-006). Ver suposição 3.

### posicoes
- **O que representa:** a carteira, com uma linha para cada par investidor × ativo.
- **De onde veio:** RF-005, RF-010, RF-016, S-01.
- **Decisões não óbvias:**
  - **Chave composta** `(investidor_id, ativo_id)`: um investidor tem no máximo uma posição por ativo.
  - `quantidade_reservada` faz para as ações o que `saldo_reservado` faz para o dinheiro (RF-010).
  - `preco_medio` é guardado, e não recalculado a partir do histórico. O cálculo exato dependeria de percorrer todas as compras. Com 4 casas decimais, o arredondamento acumulado fica desprezível.

### ordens
- **O que representa:** cada pedido de compra ou venda **e também o livro de ofertas**.
- **De onde veio:** RF-007 a RF-015, RF-022, RF-024, RNF-07, RNF-08; system design §1.2, §4 e §5.4.
- **Decisões não óbvias:**
  - **Não existe tabela "livro de ofertas".** O livro são as ordens com status `ABERTA` ou `PARCIAL`. O system design pede o livro "espelhado no Postgres na mesma transação". Com uma tabela separada, cada ordem existiria em dois lugares que poderiam divergir. O índice `idx_ordens_livro` torna rápida a reconstrução do livro quando o Motor reinicia (RF-024).
  - **O desempate por tempo (RF-014) usa o `id`**, e não o relógio. Como o Motor é o único escritor e processa o stream em sequência, o `id` crescente reflete exatamente a ordem de chegada definida pelo servidor. Timestamps podem empatar no mesmo milissegundo. O `id`, não.
  - `client_order_id` é **único por investidor** e implementa a regra "reenvio nunca gera ordem dupla" (§4 do system design).
  - `quantidade` guarda o valor original e `quantidade_executada` o que já casou. O restante é calculado. Assim o histórico mostra a ordem como ela foi enviada.
  - **Ordens rejeitadas também são gravadas**, com `motivo_rejeicao`, porque o RF-008 exige o histórico "com status" e `REJEITADA` é um dos status do RF-011.

### negocios
- **O que representa:** cada execução (trade) entre uma ordem de compra e uma de venda.
- **De onde veio:** RF-015, RF-016, RF-008, CA-03.
- **Decisões não óbvias:**
  - **Não guarda `comprador_id` / `vendedor_id`**, que são obtidos pelas ordens. Isso evita que o negócio diga uma coisa e a ordem outra.
  - `ativo_id` é redundante com as ordens, mas foi mantido: o painel de mercado e o gráfico de preço consultam negócios por ativo o tempo todo, e o redundante nunca muda.
  - Uma ordem pode gerar **vários negócios** (execução parcial contra várias contrapartes — RF-015).

## Relacionamentos

| Relacionamento | Cardinalidade | Em linguagem de negócio | Base no documento |
|---|---|---|---|
| posicoes → investidores | N:1 | Um investidor tem uma posição para cada ativo que possui | RF-005 |
| posicoes → ativos | N:1 | Um ativo aparece na carteira de vários investidores | RF-005 |
| ordens → investidores | N:1 | Cada ordem é de um único investidor; um investidor envia muitas ordens | RF-009, RNF-08 |
| ordens → ativos | N:1 | Cada ordem é sobre um único ativo | RF-009 |
| negocios → ordens (compra) | N:1 | Um negócio tem exatamente uma ordem de compra; uma compra pode gerar vários negócios | RF-014, RF-015 |
| negocios → ordens (venda) | N:1 | Idem, do lado da venda | RF-014, RF-015 |
| negocios → ativos | N:1 | Cada negócio é de um ativo | RF-017 |

## Regras de integridade no banco (a "segunda barreira")

O system design (§3) exige `CHECK`s no banco além da validação do Motor. Eles estão anotados nas `note` das colunas, porque o dbdiagram não os desenha. Na migração, devem virar restrições reais:

| Tabela | Restrição | Protege |
|---|---|---|
| investidores | `saldo_disponivel >= 0`, `saldo_reservado >= 0` | RNF-01 |
| investidores | `tipo = 'agente' OR perfil IS NULL` | RF-020 |
| posicoes | `quantidade_disponivel >= 0`, `quantidade_reservada >= 0` | RNF-01 |
| ordens | `preco_limite > 0`, `quantidade > 0`, `quantidade_executada BETWEEN 0 AND quantidade` | RNF-07 |
| ordens | `motivo_rejeicao` preenchido quando e só quando `status = 'REJEITADA'` | RF-011 |
| negocios | `preco > 0`, `quantidade > 0`, `ordem_compra_id <> ordem_venda_id` | RF-016 |
| ativos | `preco_inicial > 0`, `preco_atual > 0` | RF-017 |

## Suposições e pontos em aberto

| # | Suposição / conflito | Por que assumimos isso | Quem confirma |
|---|---|---|---|
| 1 | **Agentes recebem o mesmo capital e as mesmas ações iniciais dos humanos** (R$ 100.000 e 1.000 ações de cada ativo). | O S-01 fala só de "investidor humano". Sem dinheiro e ações, os agentes não conseguiriam negociar. | Grupo |
| 2 | **Um investidor pode ter ordem de compra e de venda do mesmo ativo ao mesmo tempo, e elas podem casar entre si.** | Os documentos não proíbem. Não muda o modelo, só a regra do Motor. Se for proibido, basta uma verificação no casamento. | Grupo |
| 3 | **"Início da sessão do servidor" (RF-006) = quando o sistema sobe do zero**, não quando o Motor reinicia após falha. `preco_referencia` é gravado uma vez por subida. | Se a variação zerasse a cada queda do Motor, a demo de falha (CA-05) mostraria uma "mudança" falsa no painel. | Grupo |
| 4 | **`volume_negociado` é o volume acumulado desde o início**, não só o da sessão atual. | O RF-006 não diz a janela. Se precisar ser por sessão, basta zerar junto com `preco_referencia`. | Grupo |
| 5 | **Dinheiro com 2 casas decimais** (`decimal(15,2)`) e preço médio com 4. Preços com centavos são suficientes. | Os documentos usam valores como R$ 102,00. Valores monetários nunca usam `float`. | Grupo |
| 6 | **Chaves inteiras** (`integer` / `bigint` sequencial), e não UUID. A exceção é `client_order_id`, gerado pelo cliente. | O system design não define. Com escritor único, a sequência também serve de desempate por tempo. | Grupo |
| 7 | **Sem soft delete e sem exclusão de investidores.** | Nenhum requisito pede exclusão de conta. Apagar investidores com histórico quebraria a conservação de dinheiro (CA-03). | Grupo |
| 8 | **Eventos econômicos (RF-021, Could) não têm tabela.** | Assumimos que o operador os dispara via Redis Pub/Sub e que eles só afetam o comportamento dos agentes, sem necessidade de histórico. Se quiserem mostrar os eventos no painel, é preciso adicionar a tabela `eventos_economicos`. | Grupo |
| 9 | **Não há registro de entradas e saídas do mercado.** | O RF-003 pede a lista de conectados *agora*, e o system design a coloca no Redis com TTL. Se o professor esperar um histórico de conexões, é preciso adicionar a tabela `conexoes`. | Grupo / professor |
| 10 | **Conservação de dinheiro (CA-03):** cada cadastro novo injeta R$ 100.000 no sistema. | O teste de concorrência deve comparar os totais **antes e depois das negociações**, com o mesmo conjunto de investidores, e não contra um valor fixo. | Grupo |
