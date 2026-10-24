# Agentes (NPCs)

RF-019 e RF-020. Código em [`apps/agents`](../apps/agents); usuários criados pelo seed do Gateway
([`auth/seed-agentes.ts`](../apps/gateway/src/auth/seed-agentes.ts)).

## Como funcionam

- São clientes comuns da API: entram com usuário e senha, recebem o mercado pelo WebSocket e
  mandam ordens pelo `POST /ordens`. **Não acessam banco nem Redis** (regra 3.3.5); o contêiner só
  recebe `GATEWAY_URL`. Passam pelas mesmas validações e regras dos humanos (RF-019).
- O seed cria `AGENTES_CONSERVADORES` + `AGENTES_AGRESSIVOS` investidores com `tipo = agente`,
  o perfil, o mesmo saldo e as mesmas ações de um humano (S-01) e a senha `AGENTES_SENHA`. Nomes:
  `agente-conservador-1…` e `agente-agressivo-1…`. Padrão (Q-03): 3 conservadores e 2 agressivos.
- A cada rodada, o agente: cancela as próprias ordens abertas há mais de 20 s, busca a carteira,
  pede uma decisão à estratégia (função pura) e envia o que ela devolver. O intervalo entre
  rodadas é sorteado entre 50% e 150% do intervalo do perfil.
- Contas de preço em centavos inteiros, pelo `dinheiro.ts` de `packages/contracts` (regra 3.3.1).
- Se o Gateway cair, cada agente tenta entrar de novo a cada 3 s.

## Regras de cada perfil (RF-020)

| | Conservador | Agressivo |
| --- | --- | --- |
| Intervalo | ~3 s | ~1,5 s |
| Tamanho | 1 a 10 ações; compra no máximo 2% do saldo | 20 a 100 ações; compra no máximo 10% do saldo |
| Lado | sorteado | segue a tendência: compra se o preço subiu desde a rodada anterior, vende se caiu, sorteia se parou |
| Preço da compra | 1 centavo acima da melhor compra (sem livro: até 0,5% abaixo do atual) | a melhor venda (sem livro: até 1% acima do atual) |
| Preço da venda | 1 centavo abaixo da melhor venda (sem livro: até 0,5% acima do atual) | a melhor compra (sem livro: até 1% abaixo do atual) |
| Cruza o spread? | nunca: dá liquidez ao livro | sim: consome o livro e executa na hora |
| Faixa de preço | no máximo 1% do preço atual | no máximo 2% do preço atual |
| Limite | no máximo 4 ordens abertas | realiza com mais de 8% de variação desde a referência: vende na alta e compra na queda, mesmo contra a tendência |

A faixa em volta do preço atual impede que uma oferta absurda no livro (uma compra a R$ 0,50, por
exemplo) arraste o preço: o RF-019 pede ordens "com preços próximos ao preço atual". A realização
impede que seguir a tendência se realimente até o dinheiro dos agentes acabar.

Se uma oferta do lado oposto impedir o conservador de manter um preço positivo dentro
da faixa de 1% sem cruzar o spread, ele aguarda a próxima rodada sem enviar ordem.

## Comportamento observado (21/10/2026)

Banco limpo, só os 5 agentes, sem humanos, 2 minutos:

- negócios nos três ativos desde o primeiro minuto e preços variando nos dois sentidos (ABC3 até
  +7,8%; DEF4 caiu até −7,4% e voltou para −3,7%);
- agressivos: lotes médios de ~58 ações, a maioria executada na hora ou parcial;
- conservadores: lotes médios de ~5,5 ações, quase todas ABERTA no livro, à espera;
- `load-tests/conferencia.sql`: dinheiro, ações e reservas conservados, nada negativo.

Os logs (`docker compose logs agents`) mostram cada ordem com `perfil`, `lado`, `quantidade`,
`preco` e `status`, o que deixa a diferença entre os perfis visível na demo (critério do RF-020).
