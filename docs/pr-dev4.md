# PR do Dev 4

## Título sugerido

`fix(dev4): preservar ordens incertas e sincronizar Home Broker e carteira`

## Descrição para o PR

O Home Broker podia perder a intenção de uma ordem após timeout/F5 e tratar respostas atrasadas
como estado atual. Esta alteração preserva corpo e UUID até confirmação, permite repetir a mesma
solicitação manualmente, espera o snapshot na reconexão e mostra falhas de atualização. O
cancelamento incerto oferece consulta de status; a confirmação recarrega carteira e histórico,
e uma consulta atrasada não desfaz a confirmação recebida por evento.

Também valida sessão/identidade, limpa dados ao sair ou trocar de conta, melhora o acesso por
teclado e mantém carteira/histórico em transações de leitura com snapshot repetível. As regras
financeiras continuam no Motor. A implementação prévia do Dev 1 foi preservada.

Validação local: instalação com lockfile congelado; lint, formatação e typecheck; 284 testes
TypeScript; builds de produção de Gateway e web. Os testes HTTP usam os módulos Nest, Argon2,
JWT, validação e guard reais, com pool de banco controlado. Os testes React usam DOM simulado
(jsdom), REST e eventos controlados. Isso não substitui o e2e com Postgres, Redis, Motor e
navegadores reais.

O lockfile acrescenta somente as dependências dos testes de interface e suas relações de peers;
as versões dos pacotes já presentes foram preservadas. Inclui também o ajuste anterior de
OpenTelemetry para `1.9.0` e a recusa explícita de dois pós-install, descritos em
[`revisao-dev4.md`](revisao-dev4.md). Solicitar revisão do Dev 1 para esses arquivos compartilhados.

## Como aplicar no checkout atual

O ZIP é uma cópia de trabalho; ele não contém o histórico Git. O arquivo `Alteracoes_Dev4.patch`,
na raiz do ZIP, reúne todas as mudanças desta revisão em relação ao ZIP original recebido.
Ele substitui a versão anterior desse patch: não aplicar os dois em sequência.

1. Atualizar o checkout conforme o fluxo do grupo e confirmar que não há alterações locais que
   seriam misturadas ao PR.
2. Criar uma branch própria. Não substituir arquivos `.env` nem o diretório `.git`.
3. A partir da raiz do checkout, executar `git apply --check /caminho/Alteracoes_Dev4.patch`.
   Se houver conflito com código mais recente, revisar e integrar os trechos conflitantes;
   não forçar a aplicação nem substituir o repositório inteiro pelo ZIP.
4. Aplicar o patch, conferir `git diff --check` e revisar `git diff`/`git status`.
5. Executar as verificações abaixo. Registrar os commits com a identidade de quem escreveu cada
   contribuição, preservando o crédito do código existente.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm -r typecheck
pnpm -r test
pnpm --filter @bolsa/gateway build
pnpm --filter @bolsa/web build
```

## Antes de aprovar o merge

- [ ] CI do repositório passando, incluindo Rust e integração com serviços reais.
- [ ] Fluxo de dois investidores em navegadores separados: cadastro/login, ordens, execução,
      cancelamento, reservas, P/L e histórico. Roteiro em `revisao-dev4.md`.
- [ ] Reconexão, indisponibilidade do Motor, saída/troca de conta e sessão expirada conferidas
      com o sistema executando.
- [ ] Acesso por outra máquina da LAN e conferência visual/teclado no navegador.
- [ ] Revisão do Dev 1, incluindo workspace e lockfile.

Esses itens ainda não foram executados nesta revisão. O PR pode ser aberto como rascunho para
receber o CI e a revisão. Carga e demo completa de falha continuam tarefas do grupo para a
entrega final; não são resultados certificados por este PR.

Nenhum commit, push, PR ou contato com o professor foi realizado a partir desta cópia.
