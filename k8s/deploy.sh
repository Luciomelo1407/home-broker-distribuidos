#!/usr/bin/env bash
# Script de automação para build, carga de imagens e deploy do Simulador de Bolsa no Kubernetes (Kind ou Minikube).
# Uso:
#   ./k8s/deploy.sh              # Faz build das imagens, carrega no cluster local (se Kind/Minikube) e aplica os manifestos
#   ./k8s/deploy.sh --skip-build # Apenas aplica os manifestos (kubectl apply -k k8s/) e aguarda os pods ficarem prontos

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
NAMESPACE="simulador-bolsa"
SKIP_BUILD=false

for arg in "$@"; do
  case "$arg" in
    --skip-build)
      SKIP_BUILD=true
      ;;
  esac
done

IMAGES=(
  "simulador-bolsa/engine:latest|apps/engine/Dockerfile"
  "simulador-bolsa/gateway:latest|apps/gateway/Dockerfile"
  "simulador-bolsa/web:latest|apps/web/Dockerfile"
  "simulador-bolsa/agents:latest|apps/agents/Dockerfile"
)

if [ "$SKIP_BUILD" = false ]; then
  echo "==> [1/4] Construindo imagens Docker a partir da raiz do monorepo..."
  for entry in "${IMAGES[@]}"; do
    IMAGE="${entry%%|*}"
    DOCKERFILE="${entry##*|}"
    echo "    -> docker build -t ${IMAGE} -f ${DOCKERFILE} ."
    docker build -t "${IMAGE}" -f "${ROOT_DIR}/${DOCKERFILE}" "${ROOT_DIR}"
  done

  CURRENT_CTX="$(kubectl config current-context 2>/dev/null || true)"
  if [[ "$CURRENT_CTX" == kind-* ]]; then
    KIND_CLUSTER="${CURRENT_CTX#kind-}"
    echo "==> [2/4] Contexto Kind detectado (${KIND_CLUSTER}). Carregando imagens no cluster..."
    for entry in "${IMAGES[@]}"; do
      IMAGE="${entry%%|*}"
      kind load docker-image "${IMAGE}" --name "${KIND_CLUSTER}"
    done
  elif [[ "$CURRENT_CTX" == "minikube" ]]; then
    echo "==> [2/4] Contexto Minikube detectado. Carregando imagens no cluster..."
    for entry in "${IMAGES[@]}"; do
      IMAGE="${entry%%|*}"
      minikube image load "${IMAGE}"
    done
  else
    echo "==> [2/4] Contexto atual (${CURRENT_CTX:-desconhecido}) não é Kind/Minikube padrão; pulando carga local de imagens."
  fi
else
  echo "==> [1-2/4] Pulando build e carga de imagens (--skip-build)."
fi

echo "==> [3/4] Aplicando manifestos Kubernetes via Kustomize (kubectl apply -k k8s/)..."
kubectl apply -k "${SCRIPT_DIR}"

echo "==> [4/4] Aguardando camadas de dados e microsserviços ficarem Ready no namespace '${NAMESPACE}'..."
kubectl rollout status statefulset/postgres -n "${NAMESPACE}" --timeout=120s
kubectl rollout status statefulset/redis -n "${NAMESPACE}" --timeout=120s
kubectl rollout status deployment/engine -n "${NAMESPACE}" --timeout=120s
kubectl rollout status deployment/gateway -n "${NAMESPACE}" --timeout=120s
kubectl rollout status deployment/web -n "${NAMESPACE}" --timeout=120s
kubectl rollout status deployment/agents -n "${NAMESPACE}" --timeout=120s
kubectl rollout status deployment/prometheus -n "${NAMESPACE}" --timeout=120s

echo ""
echo "=================================================================="
echo " Cluster '${NAMESPACE}' operacional!"
echo "=================================================================="
kubectl get pods,svc,hpa,pvc -n "${NAMESPACE}"
echo ""
echo "Dica para expor localmente via port-forward (compatível com Kind e Minikube):"
echo "  kubectl port-forward -n ${NAMESPACE} svc/web 3000:80 &"
echo "  kubectl port-forward -n ${NAMESPACE} svc/gateway 3001:3001 &"
echo "  kubectl port-forward -n ${NAMESPACE} svc/prometheus 9090:9090 &"
