# Schemas

JSON Schema de cada mensagem. Os nomes no Redis e as decisões por trás de cada formato estão em
[`docs/integracao.md`](../../../docs/integracao.md).

| Schema                 | Mensagem                                            | Fixtures      |
| ---------------------- | --------------------------------------------------- | ------------- |
| `comando-ordem.json`   | Gateway → Motor, campo `payload` do stream `orders` | `comando-*`   |
| `resultado-ordem.json` | Motor → Gateway, canal `ordens.resultado`           | `resultado-*` |
| `evento-mercado.json`  | Gateway → Home Broker, pelo WebSocket               | `evento-*`    |
| `api-rest.json`        | Rotas REST da P1 e formato de erro                  | `api-*`       |

O T-14 lê as fixtures pelo prefixo do nome: o TS (`src/contrato.spec.ts`) valida todas, e o Rust
(`apps/engine/tests/contrato.rs`) valida `comando-*` e `resultado-*`, que são as que o Motor troca.
