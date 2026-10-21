-- Preço médio das ações recebidas no cadastro (S-01): o preço inicial do ativo.
--
-- Sem isto, as 1.000 ações de cada ativo entram com preco_medio = 0, e o P/L do RF-005
-- mostra como "lucro" o valor inteiro das ações que o investidor ganhou ao se cadastrar
-- (docs/integracao.md §7, decisão que estava pendente). O gateway_app não tem permissão
-- para escrever preco_medio (0003_grants.sql), então o valor é posto por este trigger.
--
-- Só vale para inserções do gateway_app (cadastro e seed): o Motor grava o preço médio
-- que calculou, e mudá-lo aqui deixaria o banco diferente do estado em memória dele.

CREATE FUNCTION posicoes_preco_medio_inicial() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF current_user = 'gateway_app' AND NEW.quantidade_disponivel > 0 THEN
        SELECT preco_inicial INTO NEW.preco_medio FROM ativos WHERE id = NEW.ativo_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_posicoes_preco_medio_inicial
    BEFORE INSERT ON posicoes
    FOR EACH ROW EXECUTE FUNCTION posicoes_preco_medio_inicial();

-- Bancos que já existem: as posições iniciais que ainda não foram mexidas. O Motor só zera
-- o preço médio quando a posição fica vazia, então preço 0 com ações é sempre do cadastro.
-- Roda antes de o Motor carregar o estado (migrações vêm primeiro no main.rs).
UPDATE posicoes p
   SET preco_medio = a.preco_inicial
  FROM ativos a
 WHERE a.id = p.ativo_id
   AND p.preco_medio = 0
   AND p.quantidade_disponivel + p.quantidade_reservada > 0;
