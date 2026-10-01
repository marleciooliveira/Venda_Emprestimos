import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const ALLOWED_ORIGIN = "https://app.m2sec.com.br";
const TOKEN_PARAM_NAME = "/m2sec-security/mercadopago/access-token";

const PLANS = {
  essencial: { title: "Plano Essencial - M2SEC Security", unit_price: 297 },
  profissional: { title: "Plano Profissional - M2SEC Security", unit_price: 597 },
  completo: { title: "Plano Completo - M2SEC Security", unit_price: 997 }
};

let cachedToken = null;
let cachedAt = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now - cachedAt < 5 * 60 * 1000) return cachedToken;
  const client = new SSMClient({});
  const res = await client.send(new GetParameterCommand({
    Name: TOKEN_PARAM_NAME,
    WithDecryption: true
  }));
  cachedToken = res.Parameter.Value;
  cachedAt = now;
  return cachedToken;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
}

export const handler = async (event) => {
  const headers = corsHeaders();
  const method = event.requestContext?.http?.method;

  if (method === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "invalid_json" }) };
  }

  const plan = body.plan;
  const planInfo = PLANS[plan];
  if (!planInfo) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "invalid_plan" }) };
  }

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("Failed to load access token", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "config_error" }) };
  }

  const externalReference = `${plan}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const preference = {
    items: [{
      title: planInfo.title,
      quantity: 1,
      currency_id: "BRL",
      unit_price: planInfo.unit_price
    }],
    back_urls: {
      success: "https://app.m2sec.com.br/obrigado.html",
      pending: "https://app.m2sec.com.br/pagamento-pendente.html",
      failure: "https://app.m2sec.com.br/pagamento-recusado.html"
    },
    auto_return: "approved",
    external_reference: externalReference,
    notification_url: process.env.WEBHOOK_URL || undefined,
    statement_descriptor: "M2SEC SECURITY"
  };

  let resp;
  try {
    resp = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(preference)
    });
  } catch (err) {
    console.error("Network error calling Mercado Pago", err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "mp_network_error" }) };
  }

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("Mercado Pago preference error", resp.status, errText);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "mp_error" }) };
  }

  const data = await resp.json();
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      init_point: data.init_point,
      external_reference: externalReference
    })
  };
};
