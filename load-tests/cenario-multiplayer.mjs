// T-16 / CA-02: cenário do §6 do enunciado. Use uma instância isolada, sem agentes
// nem outros clientes. Não limpa banco nem cancela ordens de terceiros.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const gateway = process.env.GATEWAY ?? 'http://localhost:3001';
const ativo = 'ABC3';
const rodada = randomUUID().slice(0, 8);
const clientes = [];

async function api(caminho, token, corpo, method = corpo ? 'POST' : 'GET') {
  const res = await fetch(`${gateway}${caminho}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    signal: globalThis.AbortSignal.timeout(10_000),
  });
  assert(res.ok, `${method} ${caminho}: ${res.status} ${res.ok ? '' : await res.text()}`);
  return res.json();
}

async function esperar(condicao, descricao) {
  const limite = Date.now() + 10_000;
  while (!condicao()) {
    assert(Date.now() < limite, `timeout: ${descricao}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const centavos = (valor) => BigInt(valor.replace('.', ''));
const quantidade = (carteira) => {
  const posicao = carteira.posicoes.find((p) => p.ativo === ativo);
  assert(posicao, 'posição inicial ausente');
  return posicao.quantidadeDisponivel + posicao.quantidadeReservada;
};

try {
  const livro = await api(`/mercado/livro/${ativo}`);
  assert(
    livro.ofertasCompra.length === 0 && livro.ofertasVenda.length === 0,
    'o cenário exige livro vazio; execute em uma instância isolada, sem agentes',
  );
  const antesMercado = (await api('/mercado')).ativos.find((a) => a.codigo === ativo);

  for (const nome of ['joao', 'maria', 'pedro']) {
    const credenciais = { nomeUsuario: `t16-${rodada}-${nome}`, senha: `t16-${randomUUID()}` };
    await api('/auth/cadastro', undefined, credenciais);
    const { token } = await api('/auth/login', undefined, credenciais);
    const cliente = { nome, token, eventos: [], ws: undefined };
    clientes.push(cliente);
    cliente.ws = new globalThis.WebSocket(
      `${gateway.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`,
    );
    cliente.ws.addEventListener('message', (mensagem) => {
      cliente.eventos.push(JSON.parse(String(mensagem.data)));
    });
    await esperar(() => cliente.eventos.some((e) => e.tipo === 'SNAPSHOT'), `snapshot de ${nome}`);
    cliente.antes = await api('/carteira', token);
  }

  // Não se presume qual requisição concorrente chegará primeiro ao servidor.
  const ordens = await Promise.all(
    clientes.map((cliente, i) =>
      api('/ordens', cliente.token, {
        clientOrderId: randomUUID(),
        ativo,
        lado: i === 2 ? 'VENDA' : 'COMPRA',
        quantidade: [10, 20, 30][i],
        preco: '25.00',
      }),
    ),
  );

  for (const [i, cliente] of clientes.entries()) {
    const ordem = ordens[i];
    await esperar(
      () =>
        cliente.eventos.some(
          (e) =>
            e.tipo === 'ORDEM_ATUALIZADA' &&
            e.dados.id === ordem.id &&
            e.dados.status === 'EXECUTADA',
        ),
      `execução notificada de ${cliente.nome}`,
    );
    await esperar(
      () =>
        ['NEGOCIO', 'PRECO', 'LIVRO'].every((tipo) =>
          cliente.eventos.some((e) => e.tipo === tipo && e.dados.ativo === ativo),
        ),
      `mercado atualizado para ${cliente.nome}`,
    );
    const persistida = await api(`/ordens/${ordem.id}`, cliente.token);
    assert.equal(persistida.status, 'EXECUTADA');
    assert.equal(persistida.quantidadeExecutada, [10, 20, 30][i]);
    const historico = await api('/historico', cliente.token);
    assert(historico.ordens.some((o) => o.id === ordem.id && o.status === 'EXECUTADA'));
    const negocios = historico.negocios.filter((n) => n.ordemId === ordem.id);
    assert.equal(
      negocios.reduce((total, n) => total + n.quantidade, 0),
      [10, 20, 30][i],
    );
    assert(negocios.every((n) => n.preco === '25.00'));
    cliente.depois = await api('/carteira', cliente.token);
    const diferenca = [10, 20, -30][i];
    assert.equal(quantidade(cliente.depois) - quantidade(cliente.antes), diferenca);
    assert.equal(
      centavos(cliente.depois.saldoDisponivel) - centavos(cliente.antes.saldoDisponivel),
      -BigInt(diferenca) * 2500n,
    );
    assert.equal(cliente.depois.saldoReservado, '0.00');
    assert.equal(cliente.depois.posicoes.find((p) => p.ativo === ativo).quantidadeReservada, 0);
  }
  const depoisMercado = (await api('/mercado')).ativos.find((a) => a.codigo === ativo);
  assert.equal(depoisMercado.precoAtual, '25.00');
  assert.equal(depoisMercado.volume - antesMercado.volume, 30);
  const depoisLivro = await api(`/mercado/livro/${ativo}`);
  assert.equal(depoisLivro.ofertasCompra.length + depoisLivro.ofertasVenda.length, 0);
  console.log(
    JSON.stringify(
      {
        prova: 'T-16 / CA-02',
        resultado: 'PASSOU',
        gateway,
        ativo,
        verificacoes: [
          'ordens concorrentes',
          'validação e matching',
          'preço e quantidade',
          'saldo e carteira',
          'livro e mercado',
          'consulta persistida e histórico',
          'notificações dos três clientes',
        ],
        ordens: ordens.map((o, i) => ({
          investidor: clientes[i].nome,
          orderId: o.id,
          clientOrderId: o.clientOrderId,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  for (const cliente of clientes) cliente.ws?.close();
}
