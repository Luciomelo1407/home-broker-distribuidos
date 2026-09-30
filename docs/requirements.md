# Documento de Requisitos de Software (SRS)

**Projeto:** Simulador de Bolsa de Valores Multiplayer
**Disciplina:** Sistemas Distribuídos (COMP0470) — UFS — Prof. Rafael Oliveira Vasconcelos
**Versão:** 1.0
**Data:** 30/09/2026
**Autor(es):** [nomes do grupo — máx. 6]
**Status:** Rascunho

---

## Histórico de Revisões
| Versão | Data | Autor | Descrição da mudança |
|---|---|---|---|
| 1.0 | 30/09/2026 | Grupo | Versão inicial, derivada do enunciado "01 Projeto.pdf" |

---

## 1. Introdução

### 1.1 Propósito
Este documento descreve os requisitos do Simulador de Bolsa de Valores Multiplayer, projeto avaliativo da disciplina de Sistemas Distribuídos. Destina-se ao grupo (desenvolvimento e testes) e ao professor (avaliação). Os requisitos cobrem **o escopo mínimo obrigatório** do enunciado (§10 do PDF); diferenciais ficam como `Could`/`Won't`.

### 1.2 Escopo do Produto
- **Problema que resolve (uma frase):** permitir que vários investidores (humanos e automatizados) negociem ativos virtuais ao mesmo tempo sobre um estado compartilhado, servindo de cenário para demonstrar concorrência, consistência, sincronização e tolerância a falhas.
- **Critério de sucesso do projeto:** na apresentação final (30/11/2026), o sistema roda em contêineres e demonstra ao vivo: (1) pelo menos 2 investidores humanos + agentes operando simultaneamente; (2) ordens compatíveis sendo casadas pelo matching engine com saldo/carteira atualizados sem inconsistência; (3) Home Brokers atualizados em tempo real; (4) uma falha controlada com recuperação de estado; (5) resultados de teste de carga com 5, 20 e 50 usuários. Todos os 15 requisitos mínimos (R1–R15) do enunciado atendidos.
- **Entregas:**
  - **Parte 1 (21/10/2026):** proposta + protótipo (conexão de múltiplos clientes, login, entrada no mercado, visualização de ativos, envio de ordens, atualização básica do Home Broker).
  - **Parte 2 (30/11/2026):** matching engine, livro de ofertas, carteira, persistência, agentes, tolerância a falhas, testes, observabilidade, segurança.
- **Dentro do escopo:**
  - Um único mercado (sala) com um conjunto fixo de ativos virtuais.
  - Home Broker web simplificado.
  - Ordens limitadas de compra e venda, livro de ofertas e matching por prioridade de preço + tempo.
  - Carteira, saldo, patrimônio e histórico por investidor.
  - Agentes automatizados baseados em regras simples.
  - Persistência, reconexão, logs/métricas e testes de carga.
  - Execução em contêineres.
- **Fora do escopo (nesta versão):**
  - Ordens a mercado, stop, ordens com validade, leilão de abertura/fechamento.
  - Múltiplos mercados, ranking de investidores, eventos econômicos elaborados.
  - Machine Learning nos agentes.
  - Replicação, sharding, eleição de líder, consenso, event sourcing, CQRS (diferenciais §11 — só se sobrar tempo).
  - Dinheiro real, integração com bolsas reais, app mobile.

### 1.3 Definições, Acrônimos e Abreviações
| Termo | Definição |
|---|---|
| Ativo | Ação virtual de uma empresa fictícia (ex.: ABC3). |
| Ordem | Pedido de compra ou venda de uma quantidade de um ativo a um preço limite. |
| Ordem limitada | Ordem que só executa ao preço informado ou melhor (compra: ≤ limite; venda: ≥ limite). |
| Livro de ofertas | Lista de ordens abertas (não executadas) de compra e venda de um ativo. |
| Matching engine | Componente que casa ordens de compra e venda compatíveis e gera negociações. |
| Negociação (trade) | Execução de uma quantidade entre uma ordem de compra e uma de venda. |
| Home Broker | Interface do jogador para ver o mercado e sua carteira e enviar ordens. |
| Agente / NPC | Investidor automatizado controlado pelo sistema. |
| Preço médio | Custo médio ponderado das ações de um ativo na carteira. |
| Patrimônio | Saldo disponível + saldo reservado + Σ (quantidade × último preço) de cada ativo. |
| Saldo reservado | Dinheiro (ou ações) bloqueado por ordens abertas, para não ser usado duas vezes. |
| MoSCoW | Prioridade: Must (obrigatório), Should (importante), Could (desejável), Won't (não será feito agora). |

### 1.4 Referências
- Enunciado "01 Projeto.pdf" — Projeto de Sistemas Distribuídos, UFS, 2026 (as referências "§x do PDF" apontam para ele).

---

## 2. Descrição Geral

### 2.1 Perspectiva do Produto
Sistema novo, acadêmico, sem integração com sistemas externos. Arquitetura cliente-servidor: clientes (Home Brokers e agentes) conectam-se a um servidor/conjunto de serviços que detém a lógica e o estado do mercado.

### 2.2 Funções do Produto
1. Cadastro, login e sessão do investidor.
2. Consulta ao mercado (ativos, preços, livro de ofertas, volume).
3. Envio, consulta e cancelamento de ordens.
4. Casamento de ordens e execução de negociações.
5. Atualização de saldo/carteira e notificação em tempo real.
6. Agentes automatizados mantendo o mercado ativo.
7. Persistência, reconexão e recuperação de estado.
8. Logs, métricas e testes de carga.

### 2.3 Características dos Usuários
| Perfil de usuário | Descrição | Nível técnico |
|---|---|---|
| Investidor (jogador) | Aluno que usa o Home Broker para negociar. | Básico |
| Agente (NPC) | Investidor automatizado executado pelo sistema. | N/A |
| Operador (grupo) | Membro do grupo que sobe o sistema, roda testes e observa logs/métricas. | Avançado |

### 2.4 Restrições
- **Prazo:** Parte 1 em 21/10/2026; entrega final em 30/11/2026.
- **Equipe:** até 6 integrantes.
- **Obrigatório pelo enunciado:** arquitetura cliente-servidor (ou outra distribuída justificada); execução em contêineres; código em repositório GitHub compartilhado com o professor, com commits identificando autor; README com instruções de execução; diagramas de arquitetura.
- **Integridade acadêmica:** proibido usar código de terceiros ("outros humanos ou não-humanos"), sob pena de nota zero.
- A escolha de linguagem, protocolo (REST, WebSocket etc.) e banco é livre, mas deve ser justificada — decidida na Etapa 2 (system design).

### 2.5 Suposições e Dependências Externas
| ID | Suposição/Dependência | Quem resolve | O que trava se não for resolvida |
|---|---|---|---|
| D-01 | Regras de mercado definidas neste documento (§3.1.4) são aceitas pelo professor na Parte 1. | Grupo / professor | Implementação do matching engine |
| D-02 | Repositório GitHub criado e compartilhado com o professor. | Grupo | Avaliação (acompanhamento por commits) |
| D-03 | Máquina(s) com Docker disponível para demo e testes de carga com até 50 usuários. | Grupo | Demonstração e RNF de carga |
| S-01 | **Suposição:** 3 ativos virtuais, capital inicial de R$ 100.000,00 e 1.000 ações de cada ativo por investidor humano. | Grupo | — (valores ajustáveis) |
| S-02 | **Suposição:** mercado funciona continuamente enquanto o servidor estiver no ar (sem horário de pregão). | Grupo | — |

---

## 3. Requisitos Específicos

Coluna/campo **Entrega**: P1 = protótipo de 21/10; P2 = entrega final de 30/11. **Ref.** = requisito mínimo do enunciado (§10).

### 3.1 Requisitos Funcionais

#### 3.1.1 Sessão e autenticação

**RF-001** — Cadastro de investidor
- **Descrição:** O sistema deve permitir cadastrar um investidor com nome de usuário único e senha.
- **Prioridade:** Must — **Entrega:** P1 — **Ref.:** R2
- **Critério de aceite:** cadastro com usuário já existente é rejeitado com mensagem de erro; novo investidor recebe o capital e as ações iniciais (S-01).

**RF-002** — Login
- **Descrição:** O sistema deve autenticar o investidor por usuário e senha e criar uma sessão identificável.
- **Prioridade:** Must — **Entrega:** P1 — **Ref.:** R2, R14
- **Critério de aceite:** credenciais inválidas são rejeitadas; após login, toda requisição identifica o investidor sem reenviar a senha.

**RF-003** — Entrada e saída do mercado
- **Descrição:** O sistema deve registrar a entrada do investidor no mercado ao conectar e a saída ao desconectar ou fazer logout, mantendo a lista de investidores conectados.
- **Prioridade:** Must — **Entrega:** P1 — **Ref.:** R1
- **Critério de aceite:** com 2 navegadores logados com usuários diferentes, ambos aparecem como conectados; ao fechar um, ele deixa de aparecer em até 10 s.

**RF-004** — Reconhecimento após reconexão
- **Descrição:** O sistema deve reconhecer o investidor que reconecta dentro da validade da sessão e restaurar seu estado (saldo, carteira, ordens abertas) sem novo login.
- **Prioridade:** Must — **Entrega:** P2 — **Ref.:** R11
- **Critério de aceite:** desconectar a rede do cliente, enviar ordens de outro cliente, reconectar: o Home Broker mostra o estado atualizado sem pedir login.

#### 3.1.2 Home Broker (consulta)

**RF-005** — Painel da carteira
- **Descrição:** O Home Broker deve exibir saldo disponível, patrimônio total, ativos possuídos com quantidade e preço médio, e lucro/prejuízo da carteira.
- **Prioridade:** Must — **Entrega:** P1 (saldo e ativos) / P2 (preço médio, P/L) — **Ref.:** R3
- **Critério de aceite:** após uma compra executada, os valores exibidos batem com o cálculo manual.

**RF-006** — Painel de mercado
- **Descrição:** O Home Broker deve exibir a lista de ativos negociáveis com preço atual (último negócio), variação percentual desde o início da sessão do servidor, volume negociado e melhores ofertas de compra e venda.
- **Prioridade:** Must — **Entrega:** P1 (lista e preço) / P2 (volume, melhores ofertas) — **Ref.:** R3, R4
- **Critério de aceite:** após um negócio, preço, variação e volume do ativo mudam em todos os Home Brokers abertos.

**RF-007** — Livro de ofertas
- **Descrição:** O Home Broker deve exibir, para o ativo selecionado, as ordens de compra e venda abertas agregadas por preço (pelo menos os 5 melhores níveis de cada lado).
- **Prioridade:** Should — **Entrega:** P2 — **Ref.:** R6
- **Critério de aceite:** uma nova ordem que não casa aparece no livro de todos os clientes.

**RF-008** — Histórico
- **Descrição:** O Home Broker deve exibir o histórico de ordens (com status) e de negociações do investidor.
- **Prioridade:** Must — **Entrega:** P2 — **Ref.:** R3
- **Critério de aceite:** toda ordem enviada aparece no histórico com status correto.

#### 3.1.3 Ordens

**RF-009** — Enviar ordem de compra
- **Descrição:** O sistema deve aceitar ordem limitada de compra (ativo, quantidade inteira > 0, preço > 0) e reservar o valor `quantidade × preço` do saldo disponível.
- **Prioridade:** Must — **Entrega:** P1 (envio) / P2 (reserva) — **Ref.:** R5
- **Critério de aceite:** ordem com valor acima do saldo disponível é rejeitada com motivo; aceita, o saldo disponível diminui do valor reservado.

**RF-010** — Enviar ordem de venda
- **Descrição:** O sistema deve aceitar ordem limitada de venda e reservar as ações correspondentes da carteira.
- **Prioridade:** Must — **Entrega:** P1 (envio) / P2 (reserva) — **Ref.:** R5
- **Critério de aceite:** venda de quantidade maior que a disponível (descontadas as já reservadas) é rejeitada.

**RF-011** — Consultar status da ordem
- **Descrição:** O sistema deve informar o status de uma ordem: `ABERTA`, `PARCIAL`, `EXECUTADA`, `CANCELADA` ou `REJEITADA`.
- **Prioridade:** Must — **Entrega:** P2 — **Ref.:** R5
- **Critério de aceite:** o status muda conforme as execuções e é visível ao dono da ordem.

**RF-012** — Cancelar ordem
- **Descrição:** O sistema deve permitir que o investidor cancele o saldo restante de uma ordem aberta ou parcial **sua**, liberando a reserva.
- **Prioridade:** Should — **Entrega:** P2 — **Ref.:** R14
- **Critério de aceite:** cancelamento de ordem de outro usuário é rejeitado; após cancelar, a reserva volta ao saldo/carteira.

#### 3.1.4 Livro de ofertas e matching engine (regras do mercado)

**RF-013** — Manter livro de ofertas
- **Descrição:** O sistema deve manter, por ativo, um livro com as ordens abertas de compra (ordenadas por maior preço, depois mais antiga) e de venda (menor preço, depois mais antiga).
- **Prioridade:** Must — **Entrega:** P2 — **Ref.:** R6
- **Critério de aceite:** com o exemplo do §3 do PDF, o melhor preço de venda exibido é R$ 102 e o de compra R$ 101.

**RF-014** — Casar ordens (prioridade preço + tempo)
- **Descrição:** Ao receber uma ordem, o sistema deve casá-la com as ordens do lado oposto enquanto houver compatibilidade (compra ≥ venda), percorrendo pela prioridade preço + tempo. A ordem de chegada é definida pelo servidor no momento em que ele aceita a ordem (não pelo relógio do cliente).
- **Prioridade:** Must — **Entrega:** P2 — **Ref.:** R7
- **Critério de aceite:** no exemplo do §3 do PDF, alterar a compra do Investidor D para 150 @ R$ 102 gera negócio de 100 ações a R$ 102 com o Investidor A e deixa 50 ações de D abertas no livro.

**RF-015** — Preço e execução parcial
- **Descrição:** A negociação deve ocorrer ao preço da ordem que já estava no livro. Se as quantidades diferirem, a ordem é executada parcialmente e o restante permanece no livro.
- **Prioridade:** Must — **Entrega:** P2 — **Ref.:** R7
- **Critério de aceite:** comprador com limite R$ 105 contra venda de R$ 102 paga R$ 102 e recebe de volta a diferença reservada.

**RF-016** — Liquidar negociação atomicamente
- **Descrição:** Cada negociação deve, como uma operação única e indivisível, debitar o comprador, creditar o vendedor, transferir as ações, atualizar as ordens envolvidas e registrar o negócio. Ou tudo acontece, ou nada.
- **Prioridade:** Must — **Entrega:** P2 — **Ref.:** R7, R8
- **Critério de aceite:** a soma do dinheiro de todos os investidores e a soma de ações de cada ativo permanecem constantes após qualquer sequência de negócios (verificado no teste de concorrência — CA-03).

**RF-017** — Atualizar preço do ativo
- **Descrição:** Após cada negociação, o sistema deve atualizar o preço atual do ativo (preço do último negócio), a variação e o volume negociado.
- **Prioridade:** Must — **Entrega:** P2 — **Ref.:** R4
- **Critério de aceite:** o preço exibido é igual ao preço do último negócio registrado.

#### 3.1.5 Sincronização em tempo real

**RF-018** — Notificar clientes
- **Descrição:** O sistema deve enviar atualizações aos clientes afetados, sem que eles precisem recarregar a página, quando ocorrer: execução de ordem, alteração do livro, mudança de preço, rejeição de ordem, desconexão e reconexão.
- **Prioridade:** Must — **Entrega:** P1 (atualização básica) / P2 (todos os eventos) — **Ref.:** R8
- **Critério de aceite:** com 2 Home Brokers abertos, um negócio feito por um aparece no outro sem recarregar (tempo em RNF-02).

#### 3.1.6 Agentes automatizados

**RF-019** — Agentes negociando
- **Descrição:** O sistema deve executar pelo menos 5 agentes que enviam ordens de compra e venda periodicamente, com preços próximos ao preço atual do ativo, seguindo as mesmas regras e validações dos humanos.
- **Prioridade:** Must — **Entrega:** P2 — **Ref.:** R10
- **Critério de aceite:** com nenhum humano conectado, ocorrem negócios e o preço dos ativos varia ao longo de 1 minuto.

**RF-020** — Perfis de agente
- **Descrição:** Os agentes devem ter pelo menos 2 perfis baseados em regras (ex.: *conservador* — ordens pequenas, preço próximo ao atual; *agressivo* — ordens maiores, reage a variação de preço seguindo a tendência).
- **Prioridade:** Should — **Entrega:** P2 — **Ref.:** R10
- **Critério de aceite:** regras de cada perfil documentadas; logs mostram comportamentos distintos.

**RF-021** — Eventos econômicos
- **Descrição:** O operador pode disparar um evento (notícia positiva/negativa para um ativo) que muda o viés de compra/venda dos agentes.
- **Prioridade:** Could — **Entrega:** P2
- **Critério de aceite:** após evento negativo, o preço do ativo cai no minuto seguinte.

#### 3.1.7 Persistência e tolerância a falhas

**RF-022** — Persistir dados
- **Descrição:** O sistema deve persistir usuários, saldos, carteiras, ativos, ordens, negociações e histórico de operações.
- **Prioridade:** Must — **Entrega:** P2 — **Ref.:** R9
- **Critério de aceite:** após reiniciar todos os contêineres, saldos, carteiras, ordens abertas e histórico continuam iguais.

**RF-023** — Detectar desconexão de cliente
- **Descrição:** O sistema deve detectar a desconexão de um cliente e marcá-lo como desconectado; suas ordens abertas **permanecem no livro**.
- **Prioridade:** Must — **Entrega:** P2 — **Ref.:** R11
- **Critério de aceite:** cliente desconectado não aparece mais como conectado em até 10 s; suas ordens continuam podendo ser executadas.

**RF-024** — Recuperação após falha de serviço
- **Descrição:** Se o serviço de mercado cair e for reiniciado, ele deve recarregar o estado persistido (livro, saldos, carteiras) e os clientes devem reconectar automaticamente. Ordens recebidas mas ainda não confirmadas ao cliente antes da queda são descartadas, e o cliente é informado para reenviar.
- **Prioridade:** Must — **Entrega:** P2 — **Ref.:** R11
- **Critério de aceite:** demonstração de falha controlada (CA-05).

#### 3.1.8 Observabilidade

**RF-025** — Rastrear ciclo da ordem
- **Descrição:** O sistema deve registrar em log, com ID da ordem e horário, cada etapa: `ORDER_RECEIVED → ORDER_VALIDATED → ORDER_BOOK_INSERTED → MATCH_FOUND → TRADE_EXECUTED → PORTFOLIO_UPDATED → CLIENTS_NOTIFIED` (ou `ORDER_REJECTED` com motivo).
- **Prioridade:** Must — **Entrega:** P2 — **Ref.:** R13
- **Critério de aceite:** filtrando os logs pelo ID de uma ordem, é possível ver todo o seu caminho.

**RF-026** — Métricas
- **Descrição:** O sistema deve expor ou registrar métricas de: ordens processadas por segundo, latência de processamento de ordem, número de clientes conectados e erros.
- **Prioridade:** Must — **Entrega:** P2 — **Ref.:** R13
- **Critério de aceite:** métricas consultáveis durante o teste de carga e usadas no relatório.

**RF-027** — Dashboard de observabilidade
- **Descrição:** Painel gráfico com as métricas de RF-026.
- **Prioridade:** Could — **Entrega:** P2

### 3.2 Requisitos Não Funcionais
| ID | Categoria | Requisito (com número) | Prioridade | Ref. |
|---|---|---|---|---|
| RNF-01 | Concorrência | Duas ou mais ordens simultâneas nunca podem usar o mesmo saldo ou as mesmas ações; nenhum saldo ou quantidade de ações pode ficar negativo. A ordem de processamento é definida por uma sequência única no servidor, por ativo. | Must | R1, R8 |
| RNF-02 | Tempo real | Com até 50 usuários simultâneos, a atualização de um negócio deve chegar aos Home Brokers em até 1 s (p95). | Must | R8 |
| RNF-03 | Desempenho | Com até 50 usuários simultâneos, o tempo entre o envio da ordem e a confirmação de aceite/rejeição deve ser ≤ 500 ms (p95). *(Suposição — ajustar após o 1º teste.)* | Should | R12 |
| RNF-04 | Carga | O sistema deve ser testado com 5, 20 e 50 usuários simultâneos (humanos simulados + agentes), medindo latência, throughput (ordens/s), tempo de execução de negócios, CPU/memória e comportamento sob sobrecarga. Teste com 100+ usuários é `Could`. | Must | R12 |
| RNF-05 | Consistência | Saldo, carteira e livro de ofertas usam **consistência forte** (toda leitura após um negócio já vê o resultado). Painéis de mercado dos clientes (preço, volume) podem ter **consistência eventual** de até 1 s. A justificativa vai no system design. | Must | R8 |
| RNF-06 | Segurança | Senhas armazenadas com hash (nunca em texto puro); todas as operações exigem sessão autenticada. | Must | R14 |
| RNF-07 | Segurança | Todo parâmetro recebido (ativo, quantidade, preço, IDs) é validado no servidor; quantidade e preço inválidos (≤ 0, não numéricos, ativo inexistente) são rejeitados. | Must | R14 |
| RNF-08 | Autorização | Um investidor só pode ver, cancelar ou alterar as próprias ordens e só pode alterar o próprio saldo/carteira por meio de negociações. | Must | R14 |
| RNF-09 | Implantação | Todos os componentes (servidor/serviços, banco, cliente/agentes) devem rodar em contêineres e subir com um único comando documentado no README. | Must | R15 |
| RNF-10 | Arquitetura | A lógica principal do mercado fica no servidor/serviços; o cliente só exibe e envia comandos. A arquitetura é documentada com pelo menos um diagrama de componentes. | Must | §7.1 |
| RNF-11 | Resiliência de comunicação | Erros de comunicação (timeout, conexão perdida) devem ser tratados sem travar o cliente: o Home Broker mostra "desconectado" e tenta reconectar automaticamente a cada ≤ 5 s. | Must | §7.2 |
| RNF-12 | Manutenibilidade | Código legível, indentado e comentado; commits identificam o autor e o trabalho feito. | Must | §16 |
| RNF-13 | Escalabilidade | Uso de serviços separados (ex.: mercado, autenticação, agentes) quando isso não atrasar o mínimo obrigatório. | Should | §7.1 |
| RNF-14 | Diferenciais | Replicação, balanceamento de carga, filas/streaming de eventos, circuit breaker ou outros itens do §11. | Could | §11 |

### 3.3 Requisitos de Interface Externa
- **Interfaces de usuário:** Home Broker web para computador (navegador), com as telas: login/cadastro, painel (carteira + mercado + formulário de ordem + livro + histórico). Não precisa ser responsivo para celular.
- **Interfaces de software:** nenhuma integração com sistemas externos. Interfaces internas entre cliente e serviços definidas na Etapa 2.
- **Interfaces de comunicação:** protocolo de requisição (ex.: HTTP/REST) para comandos e canal com envio do servidor para o cliente (ex.: WebSocket) para atualizações em tempo real — escolha final e justificativa no system design.

---

## 4. Critérios de Aceite Gerais
| ID | Critério | Trava |
|---|---|---|
| CA-01 | Protótipo: 2 clientes em máquinas/navegadores diferentes fazem login, veem os ativos, enviam ordens e veem atualização básica. | Entrega Parte 1 (21/10) |
| CA-02 | Cenário do §6 do PDF (João compra, Maria compra, Pedro vende ao mesmo tempo) executa corretamente os 8 passos, com logs de RF-025. | Entrega final |
| CA-03 | Teste de concorrência: N clientes enviam ordens simultâneas por 1 min; ao final, a soma total de dinheiro e de ações por ativo é igual à inicial e nenhum saldo fica negativo. | Entrega final |
| CA-04 | Relatório de teste de carga com 5, 20 e 50 usuários contendo as métricas de RNF-04. | Entrega final |
| CA-05 | Falha controlada na apresentação: derrubar o contêiner do serviço de mercado (e/ou desconectar um cliente), mostrando qual componente falhou, impacto esperado, como foi detectado, como o sistema reagiu, qual estado foi preservado e como se recuperou. | Apresentação final |
| CA-06 | Checklist do §17 do PDF completo (código, README, diagrama, Home Broker, login, ativos/carteira, ordens, livro, matching, tempo real, persistência, agentes, reconexão, testes, logs/métricas, demo de falha, documentação técnica). | Entrega final |

---

## 5. Apêndices

### Apêndice A — Rastreabilidade com os requisitos mínimos do enunciado (§10)
| Enunciado | Requisitos deste documento |
|---|---|
| R1 Múltiplos clientes | RF-003, RNF-01 |
| R2 Autenticação | RF-001, RF-002 |
| R3 Home Broker | RF-005, RF-006, RF-008 |
| R4 Ativos | RF-006, RF-017, S-01 |
| R5 Ordens | RF-009, RF-010, RF-011 |
| R6 Livro de ofertas | RF-007, RF-013 |
| R7 Matching Engine | RF-014, RF-015, RF-016 |
| R8 Sincronização | RF-018, RNF-02, RNF-05 |
| R9 Persistência | RF-022 |
| R10 IA/agentes | RF-019, RF-020 |
| R11 Falhas | RF-004, RF-023, RF-024, CA-05 |
| R12 Escalabilidade | RNF-03, RNF-04, CA-04 |
| R13 Observabilidade | RF-025, RF-026 |
| R14 Segurança | RNF-06, RNF-07, RNF-08, RF-012 |
| R15 Contêineres | RNF-09 |

### Apêndice B — Ativos iniciais (suposição S-01)
| Código | Empresa fictícia | Preço inicial |
|---|---|---|
| ABC3 | ABC Tecnologia | R$ 25,00 |
| DEF4 | DEF Energia | R$ 100,00 |
| GHI3 | GHI Varejo | R$ 10,00 |

### Apêndice C — Questões em aberto
| ID | Questão | Dono | Prazo | O que trava |
|---|---|---|---|---|
| Q-01 | Nomes e matrículas dos integrantes do grupo. | Grupo | 07/10/2026 | Capa do documento |
| Q-02 | O professor aceita os valores de S-01 (3 ativos, R$ 100.000, 1.000 ações)? | Grupo (confirmar na Parte 1) | 21/10/2026 | Nada crítico — valores são configuráveis |
| Q-03 | Quantos agentes rodar por padrão na demo (mínimo 5) sem prejudicar o teste de carga? | Grupo | Antes do teste de carga | RNF-04 |

---

## Checklist
- [x] Todo RF e RNF tem ID e prioridade MoSCoW
- [x] Cada requisito é mensurável e testável
- [x] RNFs de volume/velocidade têm números (50 usuários, 1 s, 500 ms)
- [x] "Fora do escopo" preenchido
- [x] Critério de sucesso declarado
- [x] Dependências externas e questões em aberto listadas com dono
- [ ] Todos os integrantes do grupo revisaram
