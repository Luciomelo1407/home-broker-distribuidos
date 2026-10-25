// Complemento do T-16: confere os logs reais usando os IDs produzidos pelo cenário.
// node load-tests/rastro-multiplayer.mjs resultado.json logs.jsonl
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const [resultado, logs] = process.argv.slice(2);
assert(resultado && logs, 'informe resultado.json e logs.jsonl do cenário T-16');
const cenario = JSON.parse(readFileSync(resultado, 'utf8'));
assert.equal(cenario.resultado, 'PASSOU');
const linhas = readFileSync(logs, 'utf8')
  .split('\n')
  .flatMap((linha) => {
    try {
      return [JSON.parse(linha)];
    } catch {
      return [];
    }
  });
const etapas = new Set();
for (const ordem of cenario.ordens) {
  const rastro = linhas.filter(
    (linha) => linha.orderId === ordem.orderId || linha.clientOrderId === ordem.clientOrderId,
  );
  const possui = (stage) => rastro.some((linha) => linha.stage === stage);
  for (const stage of [
    'ORDER_RECEIVED',
    'ORDER_VALIDATED',
    'PORTFOLIO_UPDATED',
    'CLIENTS_NOTIFIED',
  ]) {
    assert(possui(stage), `ordem ${ordem.orderId}: falta ${stage}`);
  }
  // Uma ordem pode executar totalmente na chegada, sem sobrar nada para inserir no livro.
  assert(
    possui('ORDER_BOOK_INSERTED') || possui('MATCH_FOUND'),
    `ordem ${ordem.orderId}: não inseriu nem casou`,
  );
  for (const linha of rastro) if (linha.stage) etapas.add(linha.stage);
}
for (const stage of [
  'ORDER_RECEIVED',
  'ORDER_VALIDATED',
  'ORDER_BOOK_INSERTED',
  'MATCH_FOUND',
  'TRADE_EXECUTED',
  'PORTFOLIO_UPDATED',
  'CLIENTS_NOTIFIED',
]) {
  assert(etapas.has(stage), `cenário incompleto: falta ${stage}`);
}
console.log(
  JSON.stringify(
    {
      prova: 'T-16 / RF-025',
      resultado: 'PASSOU',
      ordens: cenario.ordens.map((o) => o.orderId),
      etapas: [...etapas],
    },
    null,
    2,
  ),
);
