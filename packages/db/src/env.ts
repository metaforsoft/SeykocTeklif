import path from "node:path";
import dotenv from "dotenv";

const rootEnvPath = path.resolve(__dirname, "../../../.env");
const localEnvPath = path.resolve(__dirname, "../../../.env.local");

// Resolve monorepo env files consistently from both src/ and dist/.
// .env.local has higher priority and can keep secrets out of the shared .env file.
dotenv.config({ path: rootEnvPath });
dotenv.config({ path: localEnvPath, override: true });
dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing env var: ${name}`);
  }
  return v;
}

function optional(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

export const env = {
  erp: {
    host: required("ERP_PG_HOST"),
    port: Number(required("ERP_PG_PORT")),
    database: required("ERP_PG_DB"),
    user: required("ERP_PG_USER"),
    password: required("ERP_PG_PASSWORD"),
    stockView: required("ERP_STOCK_VIEW"),
    columns: {
      stockId: optional("ERP_COL_STOCK_ID", "stock_id"),
      stockCode: optional("ERP_COL_STOCK_CODE", "stock_code"),
      stockName: optional("ERP_COL_STOCK_NAME", "stock_name"),
      stockName2: optional("ERP_COL_STOCK_NAME2", "stock_name2"),
      description: optional("ERP_COL_DESCRIPTION", "description"),
      category1: optional("ERP_COL_CATEGORY1", "category1"),
      birim: optional("ERP_COL_BIRIM", "Birim"),
      en: optional("ERP_COL_EN", "En"),
      boy: optional("ERP_COL_BOY", "Boy"),
      yukseklik: optional("ERP_COL_YUKSEKLIK", "Yükseklik"),
      cap: optional("ERP_COL_CAP", "Çap"),
      updatedAt: process.env["ERP_COL_UPDATED_AT"] ?? "updated_at"
    }
  },
  match: {
    host: required("MATCH_PG_HOST"),
    port: Number(required("MATCH_PG_PORT")),
    database: required("MATCH_PG_DB"),
    user: required("MATCH_PG_USER"),
    password: required("MATCH_PG_PASSWORD")
  },
  erpOrder: {
    endpoint: process.env["ERP_ORDER_ENDPOINT"] ?? "",
    apiKey: process.env["ERP_ORDER_API_KEY"] ?? ""
  },
  erpOffer: {
    endpoint: process.env["ERP_OFFER_ENDPOINT"] ?? process.env["ERP_ORDER_ENDPOINT"] ?? "",
    apiKey: process.env["ERP_OFFER_API_KEY"] ?? process.env["ERP_ORDER_API_KEY"] ?? ""
  },
  uyumLookup: {
    baseUrl: process.env["UYUM_LOOKUP_BASE_URL"] ?? "",
    user: process.env["UYUM_LOOKUP_USER"] ?? "",
    password: process.env["UYUM_LOOKUP_PASSWORD"] ?? "",
    bearerToken: process.env["UYUM_LOOKUP_BEARER_TOKEN"] ?? "",
    secretKey: process.env["UYUM_LOOKUP_SECRET_KEY"] ?? ""
  },
  orderDispatch: {
    intervalSeconds: Number(optional("ORDER_DISPATCH_INTERVAL_SECONDS", "15")),
    batchSize: Number(optional("ORDER_DISPATCH_BATCH_SIZE", "20")),
    maxAttempts: Number(optional("ORDER_DISPATCH_MAX_ATTEMPTS", "12"))
  },
  syncIntervalSeconds: Number(optional("SYNC_INTERVAL_SECONDS", "300")),
  apiPort: Number(optional("API_PORT", "8080"))
};
