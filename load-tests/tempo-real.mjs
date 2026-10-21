// RNF-02: tempo entre o negócio (executado_em, gravado pelo Motor) e a chegada do evento
// NEGOCIO em cada Home Broker conectado. Rode junto com uma carga do ordens.js:
//
//   node load-tests/tempo-real.mjs 50 60      # 50 conexões observando por 60 s
//
// Mede na mesma máquina do compose, para que os relógios do Postgres e deste script sejam
// o mesmo. Usa o `ws` do Gateway: rode da raiz do repositório depois de `pnpm install`.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(new URL('../apps/gateway/package.json', import.meta.url));
const { WebSocket } = require('ws');

const GATEWAY = process.env.GATEWAY ?? 'http://localhost:3001';
const CONEXOES = Number(process.argv[2] ?? 10);
const SEGUNDOS = Number(process.argv[3] ?? 30);

async function postar(caminho, corpo) {
  const res = await fetch(`${GATEWAY}${caminho}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  if (!res.ok) throw new Error(`${caminho}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function token() {
  const credenciais = { nomeUsuario: `rt-${randomUUID().slice(0, 12)}`, senha: 'senha-rt' };
  await postar('/auth/cadastro', credenciais);
  return (await postar('/auth/login', credenciais)).token;
}

const atrasos = [];
const sockets = await Promise.all(
  Array.from({ length: CONEXOES }, async () => {
    const ws = new WebSocket(`${GATEWAY.replace(/^http/, 'ws')}/ws?token=${await token()}`);
    ws.on('message', (dados) => {
      const evento = JSON.parse(dados.toString());
      if (evento.tipo === 'NEGOCIO') atrasos.push(Date.now() - Date.parse(evento.dados.momento));
    });
    await new Promise((pronto, falha) => ws.once('open', pronto).once('error', falha));
    return ws;
  }),
);
console.log(`${CONEXOES} conexões abertas; observando por ${SEGUNDOS} s…`);
await new Promise((r) => setTimeout(r, SEGUNDOS * 1000));
for (const ws of sockets) ws.terminate();

if (atrasos.length === 0) {
  console.log('nenhum NEGOCIO recebido: rode o ordens.js ao mesmo tempo');
  process.exit(1);
}
atrasos.sort((a, b) => a - b);
const p = (q) => atrasos[Math.min(atrasos.length - 1, Math.floor(q * atrasos.length))];
console.log(
  `eventos NEGOCIO recebidos: ${atrasos.length} | p50 ${p(0.5)} ms | p95 ${p(0.95)} ms | ` +
    `máx ${atrasos[atrasos.length - 1]} ms | RNF-02 (p95 ≤ 1000 ms): ${p(0.95) <= 1000 ? 'ok' : 'FALHOU'}`,
);
