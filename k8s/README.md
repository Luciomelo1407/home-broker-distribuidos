# Guia de Deploy e Testes no Kubernetes (`k8s/`)

Este diretório contém os manifestos declarativos Kubernetes (gerenciados via **Kustomize**) para execução do **Simulador de Bolsa de Valores Multiplayer** com suporte a escalabilidade horizontal na borda (`gateway`), isolamento de recursos (`requests`/`limits`), tolerância a falhas (_Self-Healing_) e observabilidade com Prometheus.

---

## 1. Estrutura dos Manifestos

| Arquivo                         | Recurso Kubernetes                                                                               | Papel na Arquitetura                                                                            |
| :------------------------------ | :----------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------- |
| `00-namespace.yaml`             | `Namespace` (`simulador-bolsa`)                                                                  | Isolamento lógico de todos os recursos do cluster.                                              |
| `01-configmap.yaml`             | `ConfigMap` (`bolsa-config`)                                                                     | Variáveis não-sensíveis, script `01-papeis.sh` do Postgres e configuração DNS do Prometheus.    |
| `02-secret.yaml`                | `Secret` (`bolsa-secrets`)                                                                       | Credenciais de banco (`postgres`, `engine_app`, `gateway_app`), `JWT_SECRET` e `AGENTES_SENHA`. |
| `03-postgres-statefulset.yaml`  | `StatefulSet` + PVC (`1Gi`) + `Service` (`ClusterIP :5432`)                                      | Fonte da verdade (PostgreSQL 16) com volume persistente e criação automática de roles.          |
| `04-redis-statefulset.yaml`     | `StatefulSet` + PVC (`512Mi`) + `Service` (`ClusterIP :6379`)                                    | Barramento Redis 7 (Stream `orders`, Pub/Sub e presença) com persistência AOF.                  |
| `05-engine-deployment.yaml`     | `Deployment` (`replicas: 1`, `Recreate`) + `Service` (`ClusterIP :9100`)                         | Motor de Casamento em Rust (escritor único sequencial) e executor das migrações SQL.            |
| `06-gateway-deployment.yaml`    | `Deployment` (`replicas: 2+`, `RollingUpdate`) + `Service` (`NodePort 30001`) + Headless Service | API Gateway NestJS (REST + WebSocket + Auth) escalável horizontalmente.                         |
| `07-gateway-hpa.yaml`           | `HorizontalPodAutoscaler` (`2` a `6` réplicas)                                                   | Autoescalonamento elástico do Gateway por CPU (70%) e Memória (80%).                            |
| `08-web-deployment.yaml`        | `Deployment` (`replicas: 2`) + `Service` (`NodePort 30000`)                                      | Home Broker (Next.js estático servido por Nginx na porta 80).                                   |
| `09-agents-deployment.yaml`     | `Deployment` (`replicas: 1`)                                                                     | Agentes automáticos (NPCs conservadores e agressivos) operando via Gateway.                     |
| `10-prometheus-deployment.yaml` | `Deployment` (`replicas: 1`) + `Service` (`NodePort 30090`)                                      | Coleta de métricas de todas as réplicas do Gateway (via DNS SD) e do Motor.                     |
| `11-ingress.yaml`               | `Ingress` (`nginx`)                                                                              | Roteamento HTTP/WebSocket por host (`bolsa.local` e `api.bolsa.local`).                         |
| `kustomization.yaml`            | `Kustomization`                                                                                  | Orquestração declarativa (`kubectl apply -k k8s/`).                                             |
| `deploy.sh`                     | Script Bash                                                                                      | Automação de build das imagens, carga no Kind/Minikube, apply e verificação de rollout.         |

---

## 2. Como Rodar as Suítes de Testes (Unitários e E2E)

Antes de subir o cluster, você pode validar todo o código TypeScript e Rust:

```bash
# 1. Linter, formatação e testes unitários TypeScript (contracts, gateway, web, agents)
pnpm lint
npx prettier --check k8s/
pnpm -r test

# 2. Testes unitários do Motor em Rust
cargo test --lib

# 3. Testes End-to-End (E2E) do Gateway contra Postgres, Redis e Motor
cp -n .env.example .env
docker compose up -d --wait postgres redis
docker compose up -d --build engine
pnpm --filter @bolsa/gateway test:e2e
docker compose down
```

---

## 3. Como Subir e Testar no Cluster Kubernetes (Kind ou Minikube)

### Passo 1: Criar o Cluster Local

**Com Kind (recomendado):**

```bash
kind create cluster --name simulador-bolsa
```

**Ou com Minikube:**

```bash
minikube start --cpus=4 --memory=6144 --addons=metrics-server,ingress
```

### Passo 2: Construir as Imagens, Carregar no Cluster e Aplicar os Manifestos

Execute o script automatizado:

```bash
./k8s/deploy.sh
```

Ou manualmente:

```bash
docker build -t simulador-bolsa/engine:latest -f apps/engine/Dockerfile .
docker build -t simulador-bolsa/gateway:latest -f apps/gateway/Dockerfile .
docker build -t simulador-bolsa/web:latest -f apps/web/Dockerfile .
docker build -t simulador-bolsa/agents:latest -f apps/agents/Dockerfile .

# No Kind:
for img in engine gateway web agents; do
  kind load docker-image "simulador-bolsa/${img}:latest" --name simulador-bolsa
done

# Aplicar via Kustomize:
kubectl apply -k k8s/
kubectl get pods,svc,pvc,hpa -n simulador-bolsa -o wide
```

---

## 4. Roteiro de Validação e Testes no Kubernetes

### 4.1 Verificar Ordenação de Subida e Negociação dos Agentes (RF-019)

```bash
kubectl logs -n simulador-bolsa deployment/engine --tail=20
kubectl logs -n simulador-bolsa deployment/agents --tail=20
```

### 4.2 Testar Escalabilidade Horizontal do Gateway (RNF-13 / §7.7)

```bash
# Escalar o Gateway para 4 réplicas simultâneas
kubectl scale deployment/gateway -n simulador-bolsa --replicas=4
kubectl rollout status deployment/gateway -n simulador-bolsa
kubectl get pods -n simulador-bolsa -l app.kubernetes.io/name=gateway -o wide
```

### 4.3 Testar Tolerância a Falhas e _Self-Healing_ do Motor (RF-024 / Demo CA-05)

```bash
# Derrubar o Pod do Motor abruptamente
kubectl delete pod -n simulador-bolsa -l app.kubernetes.io/name=engine

# Observar o Kubernetes recriar o Pod automaticamente e o Motor reconstruir o livro do Postgres
kubectl rollout status deployment/engine -n simulador-bolsa
kubectl logs -n simulador-bolsa deployment/engine --tail=20
```

### 4.4 Executar Teste de Carga (`k6`) e Auditoria SQL (`conferencia.sql`) no Cluster

Exponha a porta do `Service` do Gateway (`3001`) e execute o `k6`:

```bash
# 1. Redirecionar a porta do Service do Gateway (balanceando entre as réplicas ativas)
kubectl port-forward -n simulador-bolsa svc/gateway 3001:3001 &

# 2. Rodar o k6 (No Linux use --network host; no Windows/macOS use host.docker.internal)
docker run --rm -e GATEWAY=http://host.docker.internal:3001 -e VUS=20 -e DURACAO=15s \
  -v "$PWD/load-tests:/scripts" grafana/k6 run /scripts/ordens.js

# 3. Auditar conservação de dinheiro, ações e reservas diretamente no StatefulSet do Postgres
kubectl exec -i -n simulador-bolsa postgres-0 -- psql -U postgres -d bolsa < load-tests/conferencia.sql
```

### Resultado Validado no Cluster (`kind-simulador-bolsa`)

- **Pods:** 9/9 `Running` (`postgres-0`, `redis-0`, `engine`, `gateway` escalado até 4 réplicas, 2 réplicas `web`, `agents`, `prometheus`).
- **Teste de Carga k6 (20 VUs concorrentes + 5 NPCs, 4 réplicas do Gateway, pós-queda e recuperação do Motor):**
  - `checks_succeeded`: **100.00%** (748/748 checks, 0% falhas HTTP)
  - `http_req_duration{rota:ordens}`: **p95 = 226.67 ms** (limite RNF-03: p95 < 500 ms)
- **Auditoria `conferencia.sql` (`postgres-0`):**
  - `dinheiro`: `2500000.00` esperado / `2500000.00` total (`confere = t`)
  - `ações GHI3 / DEF4 / ABC3`: `25000` esperado / `25000` total (`confere = t`)
  - `reserva de dinheiro`: `47114.98` esperado / `47114.98` total (`confere = t`)
  - `nada negativo`: `confere = t`
