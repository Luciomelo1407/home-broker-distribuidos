// Carga de ordens (RNF-03, RNF-04, marco M5 do plano): N investidores enviam ordens
// limitadas aleatórias pelo mesmo REST dos humanos e medem o tempo até a resposta do Motor.
//
//   docker run --rm --network host -v "$PWD/load-tests:/scripts" grafana/k6 \
//     run -e VUS=5 -e DURACAO=30s /scripts/ordens.js
//
// Variáveis: VUS (padrão 5), DURACAO (30s), GATEWAY (http://localhost:3001).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const GATEWAY = __ENV.GATEWAY || 'http://localhost:3001';
const VUS = Number(__ENV.VUS || 5);

// Preço inicial de cada ativo (0002_ativos.sql). As ordens saem até 2% em volta dele, para
// que compras e vendas de investidores diferentes se cruzem e virem negócios.
const ATIVOS = { ABC3: 25, DEF4: 100, GHI3: 10 };

export const options = {
  scenarios: {
    ordens: { executor: 'constant-vus', vus: VUS, duration: __ENV.DURACAO || '30s' },
  },
  thresholds: {
    // RNF-03: envio → confirmação ≤ 500 ms no p95 (suposição do SRS, a medir)
    'http_req_duration{rota:ordens}': ['p(95)<500'],
    // 504/503 contam como falha; REJEITADA (201) não
    'checks{rota:ordens}': ['rate>0.99'],
  },
};

const rejeitadas = new Counter('ordens_rejeitadas');
const confirmacao = new Trend('ordem_confirmacao_ms', true);

const json = { headers: { 'content-type': 'application/json' } };

/** Um investidor novo por VU, com o saldo e as ações iniciais (S-01). */
export function setup() {
  const rodada = Date.now().toString(36);
  const tokens = [];
  for (let i = 0; i < VUS; i++) {
    const credenciais = JSON.stringify({ nomeUsuario: `k6-${rodada}-${i}`, senha: 'senha-k6' });
    const cadastro = http.post(`${GATEWAY}/auth/cadastro`, credenciais, json);
    check(cadastro, { 'cadastro 201': (r) => r.status === 201 });
    const login = http.post(`${GATEWAY}/auth/login`, credenciais, json);
    tokens.push(login.json('token'));
  }
  return { tokens };
}

export default function ({ tokens }) {
  const token = tokens[(__VU - 1) % tokens.length];
  const codigos = Object.keys(ATIVOS);
  const ativo = codigos[Math.floor(Math.random() * codigos.length)];
  const preco = ATIVOS[ativo] * (0.98 + Math.random() * 0.04);

  const res = http.post(
    `${GATEWAY}/ordens`,
    JSON.stringify({
      clientOrderId: uuid(),
      ativo,
      lado: Math.random() < 0.5 ? 'COMPRA' : 'VENDA',
      quantidade: 1 + Math.floor(Math.random() * 10),
      // Só dado de teste: o contrato quer string com 2 casas
      preco: preco.toFixed(2),
    }),
    { headers: { ...json.headers, authorization: `Bearer ${token}` }, tags: { rota: 'ordens' } },
  );
  const ok = check(res, { 'ordem 201': (r) => r.status === 201 }, { rota: 'ordens' });
  if (ok) {
    confirmacao.add(res.timings.duration);
    if (res.json('status') === 'REJEITADA') rejeitadas.add(1);
  }
  sleep(0.2 + Math.random() * 0.3);
}

function uuid() {
  const hex = [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
