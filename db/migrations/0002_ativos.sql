-- Ativos iniciais do mercado (Apêndice B do SRS, suposição S-01).
-- Até o primeiro negócio, preço atual e de referência são iguais ao inicial (RF-006, RF-017).

INSERT INTO ativos (codigo, nome_empresa, preco_inicial, preco_referencia, preco_atual) VALUES
    ('ABC3', 'ABC Tecnologia', 25.00, 25.00, 25.00),
    ('DEF4', 'DEF Energia', 100.00, 100.00, 100.00),
    ('GHI3', 'GHI Varejo', 10.00, 10.00, 10.00);
