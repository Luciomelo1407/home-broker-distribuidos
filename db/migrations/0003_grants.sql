-- Permissões dos papéis criados em db/init (arquitetura §2, "Papéis de banco separados").
--
-- engine_app é o dono das tabelas (aplica as migrações), portanto pode escrever em tudo.
-- gateway_app lê tudo e só insere no cadastro: sem UPDATE e sem DELETE em nenhuma tabela.
-- Assim a regra "só o Motor altera dinheiro" (system design §2) é garantida pelo próprio banco.

GRANT USAGE ON SCHEMA public TO gateway_app;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO gateway_app;

-- Tabelas criadas por migrações futuras também ficam legíveis pelo Gateway
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO gateway_app;

-- Cadastro (RF-001) e seed dos agentes: cria o investidor com o saldo inicial.
-- Só as colunas listadas: saldo_reservado e criado_em ficam sempre no valor padrão.
GRANT INSERT (nome_usuario, senha_hash, tipo, perfil, saldo_disponivel) ON investidores TO gateway_app;

-- Posições iniciais do cadastro (S-01). Reserva e preço médio ficam no valor padrão.
GRANT INSERT (investidor_id, ativo_id, quantidade_disponivel) ON posicoes TO gateway_app;

-- O id do investidor vem da identidade (sequence) da tabela
GRANT USAGE ON SEQUENCE investidores_id_seq TO gateway_app;
