# Infraestrutura — M2SEC Security

Documento de referência de tudo que foi criado/configurado em 2026-09-30/10-01: domínio e e-mail (Zoho), landing page (AWS), e gateway de pagamento (Mercado Pago). Serve pra qualquer pessoa (ou eu, em sessão futura) entender o que existe, onde, e como alterar sem precisar redescobrir tudo.

Conta AWS: **681802563258**, região **us-east-1**. Domínio: **m2sec.com.br** (Registro.br).

---

## 1. E-mail — Zoho Mail em m2sec.com.br

Objetivo: e-mail profissional `contato@m2sec.com.br` (corrigindo uma configuração anterior que apontava pro domínio errado, `m3sec.com.br`).

### 1.1 Registros DNS criados no Registro.br

Painel: `https://registro.br/painel/dominios/?dominio=m2sec.com.br` → **Configurar zona DNS** (modo avançado) → **Nova entrada**.

| Tipo | Nome | Dados |
|---|---|---|
| MX | m2sec.com.br | `10 mx.zoho.com` |
| MX | m2sec.com.br | `20 mx2.zoho.com` |
| MX | m2sec.com.br | `50 mx3.zoho.com` |
| TXT | m2sec.com.br | `v=spf1 include:zohomail.com ~all` |
| TXT | m2sec.com.br | `zoho-verification=zb41078065.zmverify.zoho.com` (prova de propriedade do domínio, exigida pelo Zoho) |
| TXT | zmail._domainkey.m2sec.com.br | `v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCWn5en1NfYWbWhprQoqR7Bxe2laLuSuGH6uRzSYkTwCoL6ahDVBOff9ejzxJhVaLVxO7jwZbT8q+ObRf3+ZPMKyGkzFPZec59/ROwVK13uatdu3MMIi0/Y3KQi4aPwViWyfmuZP0kzcOZGeRIe0j/5DkzJR/KE4YsDAma9Mv0TswIDAQAB` |

### 1.2 Como validar

No console admin do Zoho (`mailadmin.zoho.com`), seção do domínio `m2sec.com.br`: MX, SPF e DKIM devem aparecer como **"Concluído"**. Se o SPF aparecer como "não realizada" mesmo com o registro certo publicado (bug de cache do dashboard do Zoho que já aconteceu aqui), confirme via `nslookup -type=TXT m2sec.com.br` e force uma reverificação no botão "Verificar" da página específica do SPF.

### 1.3 Caixa criada

- `contato@m2sec.com.br` — mailbox completa (plano gratuito do Zoho permite 1 domínio).

### 1.4 Cuidado conhecido

O campo "Adicionar domínio" do Registro.br (fora da tela de zona DNS) tem um bug que prefixa `www.` automaticamente no valor digitado, não importa o que você digite. **Não é o mesmo formulário** usado pra adicionar entradas de DNS (esse funciona normal). Sempre usar "Configurar zona DNS" → "Nova entrada" pra adicionar registros.

---

## 2. Landing page — `https://app.m2sec.com.br`

Site estático hospedado em S3 + CloudFront, com HTTPS via certificado ACM.

### 2.1 Arquitetura

```
Usuário → https://app.m2sec.com.br (DNS CNAME)
        → CloudFront (distribuição EMT9NDCC3YHN7, domínio d1xc4sc5w69cmw.cloudfront.net)
        → S3 (bucket m2sec-security-landing, privado, acesso só via OAC)
```

### 2.2 Recursos AWS criados

| Recurso | Identificador |
|---|---|
| Bucket S3 | `m2sec-security-landing` (us-east-1, **sem acesso público** — `BlockPublicAcls/BlockPublicPolicy/IgnorePublicAcls/RestrictPublicBuckets` todos `true`) |
| Certificado ACM | `arn:aws:acm:us-east-1:681802563258:certificate/45fdea92-fd95-4f66-b794-2d020f5265c5` — domínio `app.m2sec.com.br`, validado por DNS |
| CloudFront OAC | `EKJLSVF25ES1E` (Origin Access Control, nome `m2sec-security-landing-oac`) |
| Distribuição CloudFront | `EMT9NDCC3YHN7` — domínio padrão `d1xc4sc5w69cmw.cloudfront.net` |

### 2.3 Passo a passo (como foi feito, pra refazer/replicar em outro domínio se precisar)

1. **Criar bucket S3** com acesso público totalmente bloqueado:
   ```bash
   aws s3api create-bucket --bucket m2sec-security-landing --region us-east-1
   ```
2. **Pedir certificado ACM** (tem que ser em `us-east-1` pra funcionar com CloudFront, mesmo que o site "more" em outra região):
   ```bash
   aws acm request-certificate --domain-name app.m2sec.com.br --validation-method DNS --region us-east-1
   ```
   O comando retorna um registro CNAME de validação (`ResourceRecord`) — pegar `Name` e `Value`.
3. **Publicar o CNAME de validação no Registro.br** (zona DNS, tipo CNAME). O `Name` retornado pelo ACM já vem completo (`_xxxx.app.m2sec.com.br`); no formulário do Registro.br só se digita a parte antes de `.m2sec.com.br`.
4. Esperar o ACM mudar de `PENDING_VALIDATION` pra `ISSUED` (checar com `aws acm describe-certificate --certificate-arn ... --query Certificate.Status`).
5. **Criar o Origin Access Control**:
   ```bash
   aws cloudfront create-origin-access-control --origin-access-control-config '{
     "Name": "m2sec-security-landing-oac",
     "SigningProtocol": "sigv4", "SigningBehavior": "always", "OriginAccessControlOriginType": "s3"
   }'
   ```
6. **Criar a distribuição CloudFront** apontando pro bucket S3 via OAC, com `Aliases: ["app.m2sec.com.br"]` e `ACMCertificateArn` do passo 2, `DefaultRootObject: index.html`.
7. **Atualizar a bucket policy** do S3 pra liberar leitura só pro CloudFront (via `AWS:SourceArn` da distribuição — nunca deixar o bucket público):
   ```json
   {
     "Effect": "Allow",
     "Principal": { "Service": "cloudfront.amazonaws.com" },
     "Action": "s3:GetObject",
     "Resource": "arn:aws:s3:::m2sec-security-landing/*",
     "Condition": { "StringEquals": { "AWS:SourceArn": "arn:aws:cloudfront::681802563258:distribution/EMT9NDCC3YHN7" } }
   }
   ```
8. **Apontar o DNS final**: no Registro.br, CNAME `app` → `d1xc4sc5w69cmw.cloudfront.net.` (domínio da distribuição CloudFront).
9. Esperar a distribuição ficar `Deployed` (`aws cloudfront get-distribution --id EMT9NDCC3YHN7 --query Distribution.Status`) — geralmente 5-15 min.

### 2.4 Estrutura de arquivos da landing

```
m2sec_security/landing/
  index.html               página principal (hero, como funciona, 2 caminhos do funil, planos, FAQ)
  obrigado.html             retorno do Mercado Pago quando pagamento aprovado
  pagamento-pendente.html   retorno quando pagamento fica em análise (boleto/pix)
  pagamento-recusado.html   retorno quando pagamento é recusado
```

A página principal implementa os **dois caminhos do funil**:
1. **Atendimento manual** — botão WhatsApp (`wa.me/5561996447858`) com mensagem pré-preenchida.
2. **Fluxo automatizado por plano** — botões de plano que chamam o gateway de pagamento (seção 3).

### 2.5 Como publicar uma alteração na landing

```bash
aws s3 sync "C:\Users\re049848\emprestimo\m2sec_security\landing" s3://m2sec-security-landing --delete --region us-east-1
aws cloudfront create-invalidation --distribution-id EMT9NDCC3YHN7 --paths "/*" --region us-east-1
```
O `sync --delete` reflete exclusões locais no bucket também. A invalidação é necessária porque o CloudFront cacheia os arquivos — sem ela, a mudança pode demorar até o TTL expirar pra aparecer.

---

## 3. Gateway de pagamento — Mercado Pago (Checkout Pro)

Documentação técnica completa (código-fonte, variáveis, como trocar preço) está em [`backend/README.md`](backend/README.md). Aqui vai o resumo do que foi decidido e criado.

### 3.1 Decisões tomadas (com o usuário)

- **Precificação**: proposta por referência de mercado (não copiada de concorrente específico), ajustável a qualquer momento editando o HTML e o código da Lambda.
- **Modelo de checkout**: **Checkout Pro** (redireciona pro checkout hospedado do Mercado Pago) em vez de checkout transparente embutido — mais simples de integrar num site estático e tira de nós a responsabilidade de PCI compliance de cartão.
- **Credencial (Access Token)**: nunca passa pelo chat nem fica no código — fica só no **AWS SSM Parameter Store** (`SecureString`), cadastrado diretamente pelo dono da conta AWS.

### 3.2 Preços (hoje)

| Plano | Preço | Escopo |
|---|---|---|
| Essencial | R$ 297 | até 3 links |
| Profissional (destaque) | R$ 597 | até 7 links |
| Completo | R$ 997 | links ilimitados* |

### 3.3 Arquitetura

```
Botão "Escolher plano" (landing)
  → POST /create-preference  (API Gateway → Lambda m2sec-security-create-preference)
      - busca o preço no próprio código (nunca confia em preço vindo do navegador)
      - lê o Access Token no SSM Parameter Store
      - cria uma "preference" na API do Mercado Pago
      - devolve init_point (URL do checkout)
  → navegador redireciona pro checkout do Mercado Pago
  → usuário paga (Pix, cartão ou boleto)
  → Mercado Pago chama POST /webhook  (API Gateway → Lambda m2sec-security-mp-webhook)
      - busca o pagamento de verdade na API do MP usando o id recebido
        (nunca confia no conteúdo do webhook em si — só no id, por segurança)
      - grava o resultado na tabela DynamoDB m2sec-security-payments
  → usuário é redirecionado de volta pra /obrigado.html, /pagamento-pendente.html
    ou /pagamento-recusado.html, conforme o resultado
```

### 3.4 Recursos AWS criados

| Recurso | Identificador |
|---|---|
| Lambda | `m2sec-security-create-preference` (Node.js 20.x) |
| Lambda | `m2sec-security-mp-webhook` (Node.js 20.x) |
| IAM Role (das duas Lambdas) | `m2sec-security-payments-lambda-role` — permissões: ler o parâmetro do token no SSM (com decrypt via KMS), escrever na tabela DynamoDB, e logs básicos do CloudWatch |
| API Gateway (HTTP API) | `m2sec-security-payments-api` — id `d5g44klaza` |
| Endpoint | `https://d5g44klaza.execute-api.us-east-1.amazonaws.com` |
| Rotas | `POST /create-preference`, `POST /webhook` |
| DynamoDB | `m2sec-security-payments` (chave primária `payment_id`, billing `PAY_PER_REQUEST`) |
| SSM Parameter | `/m2sec-security/mercadopago/access-token` (`SecureString`) |
| CORS da API | origem liberada só pra `https://app.m2sec.com.br` |

### 3.5 Cadastrar o Access Token (ação do usuário, não automatizável por mim)

```bash
aws ssm put-parameter \
  --name /m2sec-security/mercadopago/access-token \
  --value "SEU_ACCESS_TOKEN_AQUI" \
  --type SecureString \
  --overwrite \
  --region us-east-1
```

Recomendo testar primeiro com o **Access Token de teste (sandbox)** do Mercado Pago, fazer um pagamento fake de ponta a ponta, e só depois trocar pelo token de produção (mesmo comando, só troca o valor).

### 3.6 Como mudar o preço de um plano

1. Editar o objeto `PLANS` em `m2sec_security/backend/create-preference/index.mjs`.
2. Reempacotar e reimplantar a Lambda:
   ```bash
   cd m2sec_security/backend/create-preference
   # compactar index.mjs em .zip (PowerShell: Compress-Archive -Path index.mjs -DestinationPath ../create-preference.zip -Force)
   aws lambda update-function-code --function-name m2sec-security-create-preference --zip-file fileb://../create-preference.zip --region us-east-1
   ```
3. Editar também o preço exibido no HTML (`m2sec_security/landing/index.html`, seção `#planos`) e republicar a landing (seção 2.5).

### 3.7 O que ainda falta (fase futura, fora do escopo atual)

- Automação que, ao ver um pagamento `approved` gravado no DynamoDB, dispara a criação da solicitação de remoção de dados automaticamente (hoje esse acionamento ainda é manual: o cliente paga e é direcionado pro WhatsApp pra iniciar o processo com um atendente).
- Domínio próprio pra API (hoje usa o domínio padrão do API Gateway, `*.execute-api.amazonaws.com`).

---

## 4. Referência rápida de comandos úteis

```bash
# Status da distribuição CloudFront
aws cloudfront get-distribution --id EMT9NDCC3YHN7 --query Distribution.Status --output text

# Ver registros DNS publicados de um nome
nslookup -type=CNAME app.m2sec.com.br 8.8.8.8

# Testar o endpoint de checkout
curl -X POST https://d5g44klaza.execute-api.us-east-1.amazonaws.com/create-preference \
  -H "Content-Type: application/json" -d '{"plan":"essencial"}'

# Ver logs recentes de uma Lambda (Git Bash: usar MSYS_NO_PATHCONV=1 por causa do "/aws/lambda/...")
MSYS_NO_PATHCONV=1 aws logs filter-log-events \
  --log-group-name "/aws/lambda/m2sec-security-create-preference" \
  --region us-east-1 --start-time $(($(date +%s%N)/1000000 - 120000))

# Publicar alteração na landing
aws s3 sync m2sec_security/landing s3://m2sec-security-landing --delete --region us-east-1
aws cloudfront create-invalidation --distribution-id EMT9NDCC3YHN7 --paths "/*" --region us-east-1
```
