//! Casca do Motor (arquitetura §3.1): comando → domínio → COMMIT → troca o estado em
//! memória → resultado para publicar. Só existe um `Processador`, e ele trata um comando
//! por vez, na ordem do stream (escritor único, RF-014).

use crate::contract::{
    ComandoOrdem, LadoContrato, MercadoContrato, MotivoRejeicao, OrdemContrato, ResultadoOrdem,
    StatusContrato, decimal, stage, texto_dinheiro,
};
use crate::domain::{Estado, Lado, Ordem, Preco, Quantidade, Rejeicao};
use crate::store::{self, Catalogo, ErroStore, NovaOrdem};
use sqlx::PgPool;
use std::collections::BTreeSet;
use tracing::{error, info, warn};

/// Falha que impede continuar com o estado em memória confiável. O Motor encerra e a
/// próxima subida reconstrói tudo do Postgres (fail-fast, arquitetura §4.1).
#[derive(Debug, thiserror::Error)]
pub enum ErroProcessamento {
    #[error(transparent)]
    Store(#[from] ErroStore),
    #[error("invariante do domínio violada ({0:?}) no comando {1}")]
    Invariante(Rejeicao, String),
}

/// Uma entrada lida do stream `orders`.
pub struct Entrada<'a> {
    /// ID do Redis (`<ms>-<seq>`): a ordem global de chegada e o horário de chegada.
    pub stream_id: &'a str,
    pub payload: Option<&'a str>,
}

/// Dono do estado em memória: livro, contas carregadas e mercado.
pub struct Processador {
    pool: PgPool,
    estado: Estado,
    catalogo: Catalogo,
    ordem_timeout_ms: u64,
}

impl Processador {
    /// Reconstrói o estado a partir do Postgres (RF-024, T-07).
    pub async fn iniciar(pool: PgPool, ordem_timeout_ms: u64) -> Result<Self, ErroStore> {
        let carga = store::carregar(&pool).await?;
        info!(
            ordensNoLivro = carga.estado.ordens.len(),
            contas = carga.estado.contas.len(),
            "estado reconstruído do Postgres"
        );
        Ok(Self {
            pool,
            estado: carga.estado,
            catalogo: carga.catalogo,
            ordem_timeout_ms,
        })
    }

    /// Estado em memória atual (para testes e métricas).
    pub fn estado(&self) -> &Estado {
        &self.estado
    }

    /// Processa uma entrada. `Ok(None)`: payload fora do contrato, que é descartado (só
    /// log), porque reprocessá-lo nunca daria outro resultado.
    pub async fn processar(
        &mut self,
        entrada: &Entrada<'_>,
        agora_ms: u64,
    ) -> Result<Option<ResultadoOrdem>, ErroProcessamento> {
        let stream_id = entrada.stream_id;
        let comando = match entrada.payload.map(ComandoOrdem::de_json) {
            Some(Ok(comando)) => comando,
            Some(Err(erro)) => {
                error!(streamId = stream_id, erro = %erro, "comando fora do contrato descartado");
                return Ok(None);
            }
            None => {
                error!(streamId = stream_id, "entrada sem campo payload descartada");
                return Ok(None);
            }
        };
        let (investidor_id, client_order_id) = comando.chave();
        info!(
            stage = stage::ORDER_RECEIVED,
            streamId = stream_id,
            clientOrderId = client_order_id,
            userId = investidor_id,
            "comando recebido"
        );

        // T-08: o mesmo comando duas vezes gera uma ordem só e o mesmo resultado
        if let ComandoOrdem::Criar { .. } = comando
            && let Some(ordem) = store::buscar_por_cliente(
                &self.pool,
                &self.catalogo,
                investidor_id,
                client_order_id,
            )
            .await?
        {
            info!(
                orderId = ordem.id,
                clientOrderId = client_order_id,
                userId = investidor_id,
                "comando repetido: republica o resultado anterior"
            );
            return Ok(Some(resultado(&comando, Some(ordem), None)));
        }

        // RF-024: comando que chegou antes do timeout do Gateway já foi dado como perdido
        let expirado = chegada_ms(stream_id)
            .is_some_and(|chegada| agora_ms.saturating_sub(chegada) > self.ordem_timeout_ms);

        // Investidor que não existe (bug do emissor): descartar, como um payload inválido.
        // Parar o Motor aqui o deixaria reiniciando para sempre na mesma entrada pendente.
        if let ComandoOrdem::Criar { .. } = comando
            && !self.carregar_conta(investidor_id).await?
        {
            error!(
                streamId = stream_id,
                userId = investidor_id,
                "comando de investidor inexistente descartado"
            );
            return Ok(None);
        }

        let resultado = match &comando {
            ComandoOrdem::Criar { .. } => self.criar(&comando, stream_id, expirado).await?,
            ComandoOrdem::Cancelar { ordem_id, .. } => {
                self.cancelar(&comando, *ordem_id, expirado).await?
            }
        };
        Ok(Some(resultado))
    }

    /// Garante a conta do investidor em memória, lendo do banco se ele é novo.
    /// `false` se o investidor não existe.
    async fn carregar_conta(&mut self, investidor_id: i32) -> Result<bool, ErroStore> {
        if self.estado.contas.contains_key(&investidor_id) {
            return Ok(true);
        }
        let Some(conta) = store::carregar_conta(&self.pool, investidor_id).await? else {
            return Ok(false);
        };
        self.estado.contas.insert(investidor_id, conta);
        Ok(true)
    }

    async fn criar(
        &mut self,
        comando: &ComandoOrdem,
        stream_id: &str,
        expirado: bool,
    ) -> Result<ResultadoOrdem, ErroProcessamento> {
        let ComandoOrdem::Criar {
            client_order_id,
            investidor_id,
            ativo,
            lado,
            quantidade,
            preco,
        } = comando
        else {
            return Err(invariante(Rejeicao::EstadoInvalido, comando));
        };
        let investidor_id = *investidor_id;
        let log_rejeicao = |motivo: MotivoRejeicao| {
            info!(
                stage = stage::ORDER_REJECTED,
                clientOrderId = client_order_id.as_str(),
                userId = investidor_id,
                motivo = motivo.codigo(),
                "ordem rejeitada"
            );
        };

        let Some(ativo_id) = self.catalogo.id(ativo) else {
            // Sem ativo não há como gravar a ordem (FK), então o resultado vai sem ordem
            log_rejeicao(MotivoRejeicao::AtivoInexistente);
            return Ok(resultado(
                comando,
                None,
                Some(MotivoRejeicao::AtivoInexistente),
            ));
        };
        // O contrato já validou preço e quantidade; falhar aqui seria bug do contrato
        let preco = decimal(preco)
            .and_then(|valor| Preco::novo(valor).ok())
            .ok_or_else(|| invariante(Rejeicao::ValorInvalido, comando))?;
        let quantidade = Quantidade::nova(*quantidade).map_err(|r| invariante(r, comando))?;
        let id = store::proximo_id_ordem(&self.pool).await?;
        let lado_dominio = match lado {
            LadoContrato::Compra => Lado::Compra,
            LadoContrato::Venda => Lado::Venda,
        };
        let ordem = Ordem::nova(id, investidor_id, ativo_id, lado_dominio, preco, quantidade);
        let nova = NovaOrdem {
            client_order_id,
            stream_id,
        };

        if expirado {
            warn!(
                clientOrderId = client_order_id.as_str(),
                streamId = stream_id,
                "comando vencido descartado (RF-024)"
            );
            log_rejeicao(MotivoRejeicao::ComandoExpirado);
            let gravada = store::gravar_rejeicao(
                &self.pool,
                &self.catalogo,
                &ordem,
                &nova,
                MotivoRejeicao::ComandoExpirado,
            )
            .await?;
            return Ok(resultado(comando, Some(gravada), None));
        }

        let proposta = match self.estado.criar(ordem.clone()) {
            Ok(proposta) => proposta,
            Err(rejeicao) => {
                let motivo = motivo_de_criacao(rejeicao, lado_dominio)
                    .ok_or_else(|| invariante(rejeicao, comando))?;
                log_rejeicao(motivo);
                let gravada =
                    store::gravar_rejeicao(&self.pool, &self.catalogo, &ordem, &nova, motivo)
                        .await?;
                return Ok(resultado(comando, Some(gravada), None));
            }
        };
        info!(
            stage = stage::ORDER_VALIDATED,
            orderId = id,
            userId = investidor_id,
            "ordem validada"
        );
        if !proposta.execucoes.is_empty() {
            info!(
                stage = stage::MATCH_FOUND,
                orderId = id,
                negocios = proposta.execucoes.len(),
                "contrapartida encontrada"
            );
        }

        let gravado =
            store::gravar_resultado(&self.pool, &self.catalogo, &proposta, id, Some(&nova)).await?;
        // Só depois do COMMIT o estado em memória muda (arquitetura §3.1, T-06)
        let mercado = self.mercado_alterado(&proposta.estado, &gravado.negocios)?;
        self.estado = proposta.estado;

        for negocio in &gravado.negocios {
            info!(
                stage = stage::TRADE_EXECUTED,
                orderId = id,
                negocioId = negocio.id,
                ativo = negocio.ativo.as_str(),
                preco = negocio.preco.as_str(),
                quantidade = negocio.quantidade,
                "negócio executado"
            );
        }
        let principal = gravado.ordens.iter().find(|o| o.id == id).cloned();
        if principal
            .as_ref()
            .is_some_and(|o| matches!(o.status, StatusContrato::Aberta | StatusContrato::Parcial))
        {
            info!(
                stage = stage::ORDER_BOOK_INSERTED,
                orderId = id,
                "ordem no livro"
            );
        }
        info!(
            stage = stage::PORTFOLIO_UPDATED,
            orderId = id,
            userId = investidor_id,
            "carteiras gravadas"
        );

        Ok(ResultadoOrdem {
            client_order_id: client_order_id.clone(),
            investidor_id,
            ordem: principal,
            motivo_rejeicao: None,
            ordens_atualizadas: gravado.ordens,
            negocios: gravado.negocios,
            mercado,
        })
    }

    async fn cancelar(
        &mut self,
        comando: &ComandoOrdem,
        ordem_id: i64,
        expirado: bool,
    ) -> Result<ResultadoOrdem, ErroProcessamento> {
        let (investidor_id, client_order_id) = comando.chave();
        let rejeitar = |motivo: MotivoRejeicao, ordem: Option<OrdemContrato>| {
            info!(
                stage = stage::ORDER_REJECTED,
                orderId = ordem_id,
                clientOrderId = client_order_id,
                userId = investidor_id,
                motivo = motivo.codigo(),
                "cancelamento recusado"
            );
            Ok(resultado(comando, ordem, Some(motivo)))
        };
        if expirado {
            return rejeitar(MotivoRejeicao::ComandoExpirado, None);
        }

        let proposta = match self.estado.cancelar(investidor_id, ordem_id) {
            Ok(proposta) => proposta,
            Err(Rejeicao::OrdemDeOutroInvestidor) => {
                // RNF-08: nada da ordem de outro investidor sai no resultado
                return rejeitar(MotivoRejeicao::OrdemDeOutroInvestidor, None);
            }
            Err(Rejeicao::OrdemNaoEncontrada | Rejeicao::OrdemNaoCancelavel) => {
                // Fora do livro: pode estar no banco, já executada, cancelada ou rejeitada
                return match store::buscar_por_id(&self.pool, &self.catalogo, ordem_id).await? {
                    None => rejeitar(MotivoRejeicao::OrdemNaoEncontrada, None),
                    Some(ordem) if ordem.investidor_id != investidor_id => {
                        rejeitar(MotivoRejeicao::OrdemDeOutroInvestidor, None)
                    }
                    Some(ordem) => rejeitar(MotivoRejeicao::OrdemNaoCancelavel, Some(ordem)),
                };
            }
            Err(outra) => return Err(invariante(outra, comando)),
        };

        let gravado =
            store::gravar_resultado(&self.pool, &self.catalogo, &proposta, ordem_id, None).await?;
        self.estado = proposta.estado;
        info!(
            stage = stage::PORTFOLIO_UPDATED,
            orderId = ordem_id,
            userId = investidor_id,
            "ordem cancelada e reserva devolvida"
        );
        let principal = gravado.ordens.iter().find(|o| o.id == ordem_id).cloned();
        Ok(ResultadoOrdem {
            client_order_id: client_order_id.to_owned(),
            investidor_id,
            ordem: principal,
            motivo_rejeicao: None,
            ordens_atualizadas: gravado.ordens,
            negocios: vec![],
            mercado: vec![],
        })
    }

    /// RF-017: preço, variação e volume dos ativos que tiveram negócio neste comando.
    fn mercado_alterado(
        &self,
        estado: &Estado,
        negocios: &[crate::contract::NegocioContrato],
    ) -> Result<Vec<MercadoContrato>, ErroProcessamento> {
        let ativos: BTreeSet<&str> = negocios.iter().map(|n| n.ativo.as_str()).collect();
        let mut mercado = Vec::new();
        for codigo in ativos {
            let id = self.catalogo.id(codigo).ok_or_else(|| {
                ErroStore::Inconsistente(format!("ativo {codigo} fora do catálogo"))
            })?;
            let indicadores = estado.mercados.get(&id).ok_or_else(|| {
                ErroStore::Inconsistente(format!("mercado {codigo} fora do estado"))
            })?;
            mercado.push(MercadoContrato {
                ativo: codigo.to_owned(),
                preco_atual: texto_dinheiro(indicadores.ultimo.valor()),
                variacao: texto_dinheiro(indicadores.variacao().round_dp(2)),
                volume: indicadores.volume,
            });
        }
        Ok(mercado)
    }
}

/// Horário de chegada (ms) embutido no ID do stream (`<ms>-<seq>`), arquitetura §4.2.
pub fn chegada_ms(stream_id: &str) -> Option<u64> {
    stream_id.split_once('-')?.0.parse().ok()
}

/// Tradução da rejeição do domínio para o contrato. `None`: não é regra de negócio,
/// é estado incoerente, e o Motor para.
///
/// `ValorInvalido` na criação vem de um total (preço × quantidade) ou de uma posição que
/// não cabe no banco: para o investidor isso é falta de saldo ou de ações.
fn motivo_de_criacao(rejeicao: Rejeicao, lado: Lado) -> Option<MotivoRejeicao> {
    match rejeicao {
        Rejeicao::SaldoInsuficiente => Some(MotivoRejeicao::SaldoInsuficiente),
        Rejeicao::AcoesInsuficientes => Some(MotivoRejeicao::AcoesInsuficientes),
        Rejeicao::AtivoInexistente => Some(MotivoRejeicao::AtivoInexistente),
        Rejeicao::ValorInvalido => Some(match lado {
            Lado::Compra => MotivoRejeicao::SaldoInsuficiente,
            Lado::Venda => MotivoRejeicao::AcoesInsuficientes,
        }),
        Rejeicao::EstadoInvalido
        | Rejeicao::OrdemNaoEncontrada
        | Rejeicao::OrdemDeOutroInvestidor
        | Rejeicao::OrdemNaoCancelavel => None,
    }
}

/// Resultado de um comando que não passou pela transação (rejeição ou repetição).
fn resultado(
    comando: &ComandoOrdem,
    ordem: Option<OrdemContrato>,
    motivo: Option<MotivoRejeicao>,
) -> ResultadoOrdem {
    let (investidor_id, client_order_id) = comando.chave();
    // Com motivo, o comando não mudou nada (ex.: cancelar ordem já executada), então a
    // ordem vai só para o solicitante; sem motivo, ela é nova ou é a repetição do comando
    let atualizadas = if motivo.is_none() {
        ordem.iter().cloned().collect()
    } else {
        vec![]
    };
    ResultadoOrdem {
        client_order_id: client_order_id.to_owned(),
        investidor_id,
        ordens_atualizadas: atualizadas,
        ordem,
        motivo_rejeicao: motivo,
        negocios: vec![],
        mercado: vec![],
    }
}

fn invariante(rejeicao: Rejeicao, comando: &ComandoOrdem) -> ErroProcessamento {
    ErroProcessamento::Invariante(rejeicao, comando.chave().1.to_owned())
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn chegada_vem_do_id_do_stream() {
        assert_eq!(chegada_ms("1729500000123-0"), Some(1_729_500_000_123));
        assert_eq!(chegada_ms("sem-hifen-valido"), None);
        assert_eq!(chegada_ms("123"), None);
    }

    #[test]
    fn rejeicoes_de_estado_param_o_motor() {
        assert_eq!(
            motivo_de_criacao(Rejeicao::EstadoInvalido, Lado::Compra),
            None
        );
        assert_eq!(
            motivo_de_criacao(Rejeicao::ValorInvalido, Lado::Venda),
            Some(MotivoRejeicao::AcoesInsuficientes)
        );
    }
}
