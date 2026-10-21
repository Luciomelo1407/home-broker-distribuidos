// Serviço de Agentes (RF-019, RF-020): NPCs que usam a mesma API REST/WS dos humanos e
// não acessam banco nem Redis (regra 3.3.5). Os usuários são criados pelo seed do Gateway.
import { Agente, log } from './agente.ts';
import { lerConfig } from './config.ts';
import { agressiva } from './estrategias/agressiva.ts';
import { conservadora } from './estrategias/conservadora.ts';

const config = lerConfig(process.env);
const agentes = [
  ...Array.from(
    { length: config.conservadores },
    (_, i) => ['conservador', i + 1, conservadora] as const,
  ),
  ...Array.from({ length: config.agressivos }, (_, i) => ['agressivo', i + 1, agressiva] as const),
].map(
  // Mesmo nome que o seed do Gateway dá (auth/seed-agentes.ts)
  ([perfil, n, estrategia]) =>
    new Agente(config.gatewayUrl, `agente-${perfil}-${n}`, config.senha, estrategia),
);

log({
  conservadores: config.conservadores,
  agressivos: config.agressivos,
  msg: 'iniciando agentes',
});
await Promise.all(agentes.map((agente) => agente.iniciar()));

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sinal, () => {
    for (const agente of agentes) agente.parar();
    process.exit(0);
  });
}
