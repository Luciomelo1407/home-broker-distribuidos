# Demo de falha (CA-05)

Roteiro ensaiado em 21/10/2026, com o sistema inteiro no compose e os 5 agentes negociando. O
CA-05 pede para mostrar: qual componente falhou, o impacto esperado, como foi detectado, como o
sistema reagiu, qual estado foi preservado e como se recuperou.

## Antes de começar

```bash
docker compose down -v && docker compose up -d --build   # banco limpo
```

Abra dois Home Brokers (`http://<ip>:3000`) com usuários diferentes, deixe ordens abertas nos dois
e um terminal com `docker compose logs -f engine gateway`.

## Ato 1: o Motor morre (crash) e o Docker o traz de volta

```bash
docker compose exec engine sh -c 'kill -9 -1'
```

`kill -9 -1` mata todos os processos do contêiner menos o `init` (o compose usa `init: true`), ou
seja, o Motor morre sem aviso, como num crash. **Não use `docker kill`**: o Docker trata isso como
parada manual e não reinicia o contêiner.

| Pergunta do CA-05 | O que mostrar |
| --- | --- |
| Qual componente falhou | O Motor (`engine`), o único escritor de dinheiro, ações e ordens. |
| Impacto esperado | Nenhuma ordem é processada enquanto ele está fora; o resto continua de pé. |
| Como foi detectado | O Docker vê o processo sair e aplica `restart: unless-stopped`. |
| Como reagiu | O Motor sobe, aplica as migrações, **reconstrói o livro a partir das ordens `ABERTA`/`PARCIAL` do Postgres** (log `estado reconstruído do Postgres`, com quantas ordens e contas) e volta a consumir o stream. |
| Estado preservado | Tudo o que foi confirmado: confirmar é COMMIT. As ordens abertas continuam no livro, na mesma prioridade (T-07). |
| Como se recuperou | No ensaio, em ~300 ms. A única marca foi uma ordem que levou 294 ms em vez de ~10 ms. |

## Ato 2: o Motor fica fora por um tempo

```bash
docker compose stop engine     # espere ~15 s, mostrando as telas
docker compose start engine
```

Linha do tempo do ensaio (um cliente mandando uma ordem a cada 2 s):

| Tempo | O que aconteceu |
| --- | --- |
| 0 s | Motor parado. |
| ~4 s | Primeira ordem sem resposta: `504 NAO_CONFIRMADA` depois de 3 s ("reenvie": o `clientOrderId` impede duplicar). |
| ~5 s | O batimento `motor:heartbeat` expira (TTL de 5 s). O Gateway percebe (confere a cada 1 s) e manda `ERRO MERCADO_INDISPONIVEL` a todos os WebSockets: os Home Brokers mostram "mercado temporariamente indisponível; suas ordens abertas estão preservadas". As conexões não caem. |
| 5 s a 13 s | Cada ordem nova: `504` em 3 s. Mercado, carteira e histórico continuam respondendo (são leituras do Postgres). |
| 13 s | Motor religado. Os comandos que ficaram no stream durante a queda são **descartados com `COMANDO_EXPIRADO`** (RF-024): o cliente já os tinha dado como perdidos, e executá-los agora seria uma ordem fantasma. No ensaio, 6 comandos. |
| 13,2 s | O Gateway vê o batimento de volta, relê mercado e livro do banco e manda um `SNAPSHOT` novo a cada conexão: o aviso some e a tela fica em dia. |
| depois | Ordens confirmadas em ~10 ms, como antes. |

Para mostrar os descartados:

```bash
docker compose logs engine | grep "comando vencido"
docker compose exec postgres psql -U postgres -d bolsa \
  -c "select id, status, motivo_rejeicao from ordens where motivo_rejeicao = 'COMANDO_EXPIRADO'"
```

E a conservação depois de tudo:

```bash
docker compose exec -T postgres psql -U postgres -d bolsa < load-tests/conferencia.sql
```

## Ato 3 (opcional): um cliente perde a rede

Feche a aba de um dos Home Brokers, ou desligue a rede do computador dele. O outro vê o número de
conectados cair em até 10 s (ping a cada 5 s, RF-023; provado no e2e `RF-023` do
`realtime.e2e-spec.ts`). Ao voltar, o Home Broker reconecta sozinho em até 2 s e recebe um
`SNAPSHOT` com o estado atualizado, sem pedir login (RF-004).

## O que as provas automáticas já cobrem

T-06 (falha no meio da gravação não muda nada), T-07 (livro reconstruído igual), T-08 (reenvio
não duplica), T-09 (comando vencido descartado) e o e2e do RF-023. A demo mostra o mesmo ao vivo.
