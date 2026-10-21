//! Valores exatos compatíveis com DECIMAL(15,2) e INTEGER do banco.
use super::resultado::Rejeicao;
use rust_decimal::Decimal;

fn validar(valor: Decimal, zero: bool) -> Result<Decimal, Rejeicao> {
    if valor < Decimal::ZERO
        || (!zero && valor.is_zero())
        || valor > Decimal::from(999_999_999_999_999_i64) / Decimal::from(100)
        || valor.round_dp(2) != valor
    {
        return Err(Rejeicao::ValorInvalido);
    }
    Ok(valor)
}

/// Preço limite estritamente positivo, com precisão de centavos.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Preco(Decimal);
impl Preco {
    /// Valida preço sem arredondar entradas inválidas (RNF-07).
    pub fn novo(valor: Decimal) -> Result<Self, Rejeicao> {
        validar(valor, false).map(Self)
    }
    /// Retorna o valor exato para persistência.
    pub fn valor(self) -> Decimal {
        self.0
    }
    /// Calcula o valor reservado, verificando o limite monetário do banco.
    pub fn total(self, quantidade: Quantidade) -> Result<Dinheiro, Rejeicao> {
        Dinheiro::novo(self.0 * Decimal::from(quantidade.valor()))
    }
}
/// Saldo não negativo; zero é necessário para contas e reservas vazias.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Dinheiro(Decimal);
impl Dinheiro {
    /// Valida saldo em centavos sem conversão por ponto flutuante.
    pub fn novo(valor: Decimal) -> Result<Self, Rejeicao> {
        validar(valor, true).map(Self)
    }
    /// Retorna o saldo exato.
    pub fn valor(self) -> Decimal {
        self.0
    }
}
/// Quantidade de uma ordem: inteira, positiva e compatível com INTEGER.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Quantidade(u32);
impl Quantidade {
    /// Recusa zero e valores maiores que o banco aceita (RNF-07).
    pub fn nova(valor: u32) -> Result<Self, Rejeicao> {
        if valor == 0 || valor > i32::MAX as u32 {
            return Err(Rejeicao::ValorInvalido);
        }
        Ok(Self(valor))
    }
    /// Retorna o número de ações.
    pub fn valor(self) -> u32 {
        self.0
    }
}
