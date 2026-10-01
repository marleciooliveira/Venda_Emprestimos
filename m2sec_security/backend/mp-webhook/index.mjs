import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";

const TOKEN_PARAM_NAME = "/m2sec-security/mercadopago/access-token";
const TABLE = process.env.PAYMENTS_TABLE;

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

export const handler = async (event) => {
  const qs = event.queryStringParameters || {};
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { /* ignore, some notifications have no body */ }

  const paymentId = qs["data.id"] || body?.data?.id || body?.id;
  const type = qs.type || body.type || body.topic;

  if (type !== "payment" || !paymentId) {
    return { statusCode: 200, body: "ignored" };
  }

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("Failed to load access token", err);
    return { statusCode: 200, body: "config_error" };
  }

  let resp;
  try {
    resp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { "Authorization": `Bearer ${accessToken}` }
    });
  } catch (err) {
    console.error("Network error fetching payment", err);
    return { statusCode: 200, body: "network_error" };
  }

  if (!resp.ok) {
    console.error("Failed to fetch payment detail", paymentId, resp.status, await resp.text());
    return { statusCode: 200, body: "payment_fetch_error" };
  }

  const payment = await resp.json();
  const plan = (payment.external_reference || "").split("-")[0] || "";

  const client = new DynamoDBClient({});
  try {
    await client.send(new PutItemCommand({
      TableName: TABLE,
      Item: {
        payment_id: { S: String(payment.id) },
        status: { S: payment.status || "unknown" },
        status_detail: { S: payment.status_detail || "" },
        external_reference: { S: payment.external_reference || "" },
        plan: { S: plan },
        transaction_amount: { N: String(payment.transaction_amount ?? 0) },
        payer_email: { S: payment.payer?.email || "" },
        updated_at: { S: new Date().toISOString() }
      }
    }));
  } catch (err) {
    console.error("Failed to write payment record", err);
  }

  return { statusCode: 200, body: "ok" };
};
