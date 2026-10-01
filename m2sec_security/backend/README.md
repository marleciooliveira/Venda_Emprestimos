# Backend de pagamentos — M2SEC Security

Checkout Pro do Mercado Pago. Dois Lambdas Node.js 20.x (sem dependências empacotadas — usam `fetch` nativo e o AWS SDK v3 já embutido no runtime), expostos via API Gateway HTTP API.

## Recursos na AWS (us-east-1, conta 681802563258)

| Recurso | Nome/ID |
|---|---|
| Lambda | `m2sec-security-create-preference` |
| Lambda | `m2sec-security-mp-webhook` |
| IAM Role (ambas) | `m2sec-security-payments-lambda-role` |
| API Gateway (HTTP API) | `m2sec-security-payments-api` — id `d5g44klaza` |
| Endpoint | `https://d5g44klaza.execute-api.us-east-1.amazonaws.com` |
| Rotas | `POST /create-preference`, `POST /webhook` |
| DynamoDB | `m2sec-security-payments` (chave: `payment_id`) |
| SSM Parameter (SecureString) | `/m2sec-security/mercadopago/access-token` |

## Fluxo

1. Botão de plano na landing (`data-plan="essencial\|profissional\|completo"`) chama `POST /create-preference` com `{ "plan": "..." }`.
2. A Lambda busca o preço no próprio código (nunca confia em preço vindo do cliente), cria uma `preference` no Mercado Pago e devolve `init_point`.
3. O navegador redireciona pro checkout hospedado do Mercado Pago.
4. Após o pagamento, o Mercado Pago chama `POST /webhook` com o id do pagamento. A Lambda busca o pagamento de verdade na API do MP (nunca confia no payload do webhook) e grava o resultado no DynamoDB.
5. `back_urls` levam o usuário de volta pra `/obrigado.html`, `/pagamento-pendente.html` ou `/pagamento-recusado.html` na landing.

## Preços (hoje, em `create-preference/index.mjs`)

- Essencial — R$ 297
- Profissional — R$ 597
- Completo — R$ 997

Pra mudar preço: editar `PLANS` em `backend/create-preference/index.mjs`, reempacotar e fazer `aws lambda update-function-code`. (Também precisa editar o HTML da landing pra exibir o valor certo.)

## Cadastrar o Access Token do Mercado Pago

O token **nunca** fica no código nem no histórico do Claude — só no SSM Parameter Store, cadastrado diretamente pelo dono da conta:

```bash
aws ssm put-parameter \
  --name /m2sec-security/mercadopago/access-token \
  --value "SEU_ACCESS_TOKEN_AQUI" \
  --type SecureString \
  --overwrite \
  --region us-east-1
```

Recomendo começar com o **Access Token de teste** (sandbox) do Mercado Pago pra validar o fluxo de ponta a ponta com um pagamento fake antes de trocar pelo token de produção (mesmo comando, só troca o valor).

## O que falta (próxima fase, fora do escopo atual)

- Automação que, ao confirmar pagamento no DynamoDB, dispara a criação da solicitação de remoção de dados.
- Domínio custom pra API (hoje usa o domínio padrão do API Gateway).
