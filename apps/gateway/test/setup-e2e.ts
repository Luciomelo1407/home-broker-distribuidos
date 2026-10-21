// Os e2e sobem o AppModule inteiro: sem isto, cada requisição escreve uma linha de log.
// Variável de ambiente tem prioridade sobre o .env (config.module.ts).
process.env.LOG_LEVEL = 'silent';
