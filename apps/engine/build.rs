// Recompila quando uma migração muda: sqlx::migrate! embute os arquivos no binário.
fn main() {
    println!("cargo:rerun-if-changed=../../db/migrations");
}
