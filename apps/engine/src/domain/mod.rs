//! RF-009 a RF-017: regras determinísticas, sem I/O nem relógio.
pub mod casamento;
pub mod conta;
pub mod dinheiro;
pub mod livro;
pub mod ordem;
pub mod resultado;
pub use conta::{Conta, Posicao};
pub use dinheiro::{Dinheiro, Preco, Quantidade};
pub use livro::Livro;
pub use ordem::{Lado, Ordem, Status};
pub use resultado::{Estado, Mercado, Rejeicao, Resultado};
