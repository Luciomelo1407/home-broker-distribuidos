//! T-14 (lado Rust): as fixtures de comando e resultado de `packages/contracts` são
//! aceitas ou recusadas igual ao ajv do lado TS, e a ida e volta não perde nada.
#![allow(clippy::unwrap_used, clippy::expect_used)] // testes: permitido pela regra 3.3.6

use engine::contract::{ComandoOrdem, ErroContrato, ResultadoOrdem};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

fn fixtures(pasta: &str) -> Vec<(String, String)> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/contracts/fixtures");
    let mut arquivos: Vec<PathBuf> = fs::read_dir(dir.join(pasta))
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect();
    arquivos.sort();
    arquivos
        .into_iter()
        .map(|p| {
            let nome = p.file_name().unwrap().to_string_lossy().into_owned();
            (nome, fs::read_to_string(&p).unwrap())
        })
        .collect()
}

/// Valida pelo prefixo do nome; `None` para fixtures que o Motor não troca (api-, evento-).
fn validar(nome: &str, texto: &str) -> Option<Result<Value, ErroContrato>> {
    let ida_e_volta = |v: Result<Value, serde_json::Error>| v.unwrap();
    if nome.starts_with("comando-") {
        Some(ComandoOrdem::de_json(texto).map(|c| ida_e_volta(serde_json::to_value(c))))
    } else if nome.starts_with("resultado-") {
        Some(ResultadoOrdem::de_json(texto).map(|r| ida_e_volta(serde_json::to_value(r))))
    } else {
        None
    }
}

#[test]
fn t14_fixtures_validas_sao_aceitas_sem_perda() {
    let mut conferidas = 0;
    for (nome, texto) in fixtures("validas") {
        let Some(resultado) = validar(&nome, &texto) else {
            continue;
        };
        let reserializado = resultado.unwrap_or_else(|e| panic!("{nome} recusada: {e}"));
        let original: Value = serde_json::from_str(&texto).unwrap();
        assert_eq!(reserializado, original, "{nome}: ida e volta mudou o JSON");
        conferidas += 1;
    }
    assert!(
        conferidas >= 6,
        "só {conferidas} fixtures de comando/resultado"
    );
}

#[test]
fn t14_fixtures_invalidas_sao_recusadas() {
    let mut conferidas = 0;
    for (nome, texto) in fixtures("invalidas") {
        if let Some(resultado) = validar(&nome, &texto) {
            assert!(resultado.is_err(), "{nome} foi aceita");
            conferidas += 1;
        }
    }
    assert!(
        conferidas >= 10,
        "só {conferidas} fixtures inválidas de comando/resultado"
    );
}
