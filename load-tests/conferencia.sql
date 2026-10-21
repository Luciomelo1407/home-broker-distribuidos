-- Conferência de conservação (T-15, CA-03, RNF-01). Rode depois de uma carga:
--   docker compose exec -T postgres psql -U postgres -d bolsa < load-tests/conferencia.sql
--
-- Todo investidor nasce com SALDO_INICIAL e ACOES_INICIAIS de cada ativo (S-01), e negócio
-- só troca dinheiro e ações de mão. Então, para o conjunto inteiro:
--   soma(disponível + reservado) = investidores × saldo inicial
--   soma(ações disponíveis + reservadas) por ativo = investidores × ações iniciais
-- Os valores iniciais abaixo são os do .env.example; mude se o .env for outro.
\set saldo_inicial 100000.00
\set acoes_iniciais 1000

SELECT 'dinheiro' AS conferencia,
       sum(saldo_disponivel + saldo_reservado)                      AS total,
       count(*) * :saldo_inicial                                    AS esperado,
       sum(saldo_disponivel + saldo_reservado) = count(*) * :saldo_inicial AS confere
  FROM investidores
UNION ALL
SELECT 'ações ' || a.codigo,
       sum(p.quantidade_disponivel + p.quantidade_reservada),
       count(*) * :acoes_iniciais,
       sum(p.quantidade_disponivel + p.quantidade_reservada) = count(*) * :acoes_iniciais
  FROM posicoes p JOIN ativos a ON a.id = p.ativo_id
 GROUP BY a.codigo
UNION ALL
-- Reservas batem com o que ainda está no livro (compra: preço × restante)
SELECT 'reserva de dinheiro',
       (SELECT sum(saldo_reservado) FROM investidores),
       coalesce(sum(preco_limite * (quantidade - quantidade_executada)), 0),
       (SELECT sum(saldo_reservado) FROM investidores)
         = coalesce(sum(preco_limite * (quantidade - quantidade_executada)), 0)
  FROM ordens WHERE lado = 'compra' AND status IN ('ABERTA', 'PARCIAL')
UNION ALL
SELECT 'nada negativo',
       NULL, NULL,
       NOT EXISTS (SELECT 1 FROM investidores WHERE saldo_disponivel < 0 OR saldo_reservado < 0)
       AND NOT EXISTS (SELECT 1 FROM posicoes WHERE quantidade_disponivel < 0 OR quantidade_reservada < 0);
