import { env } from "@smp/db";

interface UyumLookupResponse {
  statusCode?: number;
  message?: string;
  result?: unknown;
  responseException?: {
    isError?: boolean;
    exceptionMessage?: string;
    validationErrors?: Array<{
      field?: string;
      message?: string;
    }>;
  };
}

interface UyumLoginResult {
  access_token?: string;
  uyumSecretKey?: string;
  token_type?: string;
  expires_in?: number;
}

export interface LookupOption {
  value: string;
  label: string;
  payload?: Record<string, unknown>;
}

interface LookupRequest {
  query?: string;
  limit?: number;
}

interface LookupDefinition {
  buildSql: (request: LookupRequest) => string;
  mapRow: (row: Record<string, unknown>) => LookupOption | null;
}

function normalizeLookupQuery(value: string | undefined): string {
  return String(value ?? "").trim();
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function toSqlPattern(value: string): string {
  return `%${escapeSqlLiteral(value)}%`;
}

function normalizeLookupLimit(value: number | undefined, fallback = 30, max = 100): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(parsed)));
}

const LOOKUP_DEFINITIONS: Record<string, LookupDefinition> = {
  "movement-codes": {
    buildSql: ({ query, limit }) => {
      const normalizedQuery = normalizeLookupQuery(query);
      const normalizedLimit = normalizeLookupLimit(limit, 30, 100);
      const filters = [
        "tra.purchase_sales=2",
        "tra.source_app=121",
        "tra.ispassive=0"
      ];
      if (normalizedQuery) {
        const pattern = toSqlPattern(normalizedQuery);
        filters.push(`(tra.doc_tra_code ilike '${pattern}' or coalesce(tra.description, '') ilike '${pattern}')`);
      }
      return `select tra.doc_tra_code, tra.description
from GNLD_DOC_TRA tra
where ${filters.join(" and ")}
order by tra.doc_tra_code
limit ${normalizedLimit}`;
    },
    mapRow: (row) => {
      const code = readStringField(row, ["doC_TRA_CODE", "doc_tra_code"]);
      const description = readStringField(row, ["description"]);
      if (!code) return null;
      return {
        value: code,
        label: [code, description].filter(Boolean).join(" "),
        payload: {
          code,
          description
        }
      };
    }
  },
  customers: {
    buildSql: ({ query, limit }) => {
      const normalizedQuery = normalizeLookupQuery(query);
      const normalizedLimit = normalizeLookupLimit(limit, 30, 100);
      const filters = [
        "ent.ispassive=0"
      ];
      if (normalizedQuery) {
        const pattern = toSqlPattern(normalizedQuery);
        filters.push(`(ent.entity_code ilike '${pattern}' or coalesce(ent.entity_name, '') ilike '${pattern}')`);
      }
      return `select
ent.entity_code,
ent.entity_name
from find_entity ent
where ${filters.join(" and ")}
order by ent.entity_code
limit ${normalizedLimit}`;
    },
    mapRow: (row) => {
      const code = readStringField(row, ["entity_code"]);
      const name = readStringField(row, ["entity_name"]);
      if (!code) return null;
      return {
        value: code,
        label: [code, name].filter(Boolean).join(" "),
        payload: {
          code,
          name
        }
      };
    }
  },
  representatives: {
    buildSql: ({ query, limit }) => {
      const normalizedQuery = normalizeLookupQuery(query);
      const normalizedLimit = normalizeLookupLimit(limit, 30, 100);
      const filters: string[] = [];
      if (normalizedQuery) {
        const pattern = toSqlPattern(normalizedQuery);
        filters.push(`(per.sales_person_code ilike '${pattern}' or coalesce(per.first_name, '') ilike '${pattern}')`);
      }
      const whereSql = filters.length > 0 ? `where ${filters.join(" and ")}` : "";
      return `select
per.sales_person_code,
per.first_name
from find_sales_person per
${whereSql}
order by per.sales_person_code
limit ${normalizedLimit}`;
    },
    mapRow: (row) => {
      const code = readStringField(row, ["sales_person_code"]);
      const name = readStringField(row, ["first_name"]);
      if (!code) return null;
      return {
        value: code,
        label: [code, name].filter(Boolean).join(" "),
        payload: {
          code,
          name
        }
      };
    }
  },
  warehouses: {
    buildSql: ({ query, limit }) => {
      const normalizedQuery = normalizeLookupQuery(query);
      const normalizedLimit = normalizeLookupLimit(limit, 30, 100);
      const filters = [
        "who.ispassive=0"
      ];
      if (normalizedQuery) {
        const pattern = toSqlPattern(normalizedQuery);
        filters.push(`(who.whouse_code ilike '${pattern}' or coalesce(who.description, '') ilike '${pattern}')`);
      }
      return `select
who.whouse_code,
who.description
from invd_whouse who
where ${filters.join(" and ")}
order by who.whouse_code
limit ${normalizedLimit}`;
    },
    mapRow: (row) => {
      const code = readStringField(row, ["whouse_code"]);
      const description = readStringField(row, ["description"]);
      if (!code) return null;
      return {
        value: code,
        label: [code, description].filter(Boolean).join(" "),
        payload: {
          code,
          description
        }
      };
    }
  },
  "payment-plans": {
    buildSql: ({ query, limit }) => {
      const normalizedQuery = normalizeLookupQuery(query);
      const normalizedLimit = normalizeLookupLimit(limit, 30, 100);
      const filters: string[] = [];
      if (normalizedQuery) {
        const pattern = toSqlPattern(normalizedQuery);
        filters.push(`(pc.payment_plan_code ilike '${pattern}' or coalesce(pc.description, '') ilike '${pattern}')`);
      }
      const whereSql = filters.length > 0 ? `where ${filters.join(" and ")}` : "";
      return `select
pc.payment_plan_code,
pc.description
from FIND_PAYMENT_PLAN pc
${whereSql}
order by pc.payment_plan_code
limit ${normalizedLimit}`;
    },
    mapRow: (row) => {
      const code = readStringField(row, ["payment_plan_code"]);
      const description = readStringField(row, ["description"]);
      if (!code) return null;
      return {
        value: code,
        label: [code, description].filter(Boolean).join(" "),
        payload: {
          code,
          description
        }
      };
    }
  },
  incoterms: {
    buildSql: ({ query, limit }) => {
      const normalizedQuery = normalizeLookupQuery(query);
      const normalizedLimit = normalizeLookupLimit(limit, 30, 100);
      const filters: string[] = [];
      if (normalizedQuery) {
        const pattern = toSqlPattern(normalizedQuery);
        filters.push(`tt.transport_type_code ilike '${pattern}'`);
        filters.push(`tt.description ilike '${pattern}'`);
      }
      const whereSql = filters.length > 0 ? `where (${filters.join(" or ")})` : "";
      return `select
tt.transport_type_code,
tt.description
from PSMD_TRANSPORT_TYPE tt
${whereSql}
order by tt.transport_type_code, tt.description
limit ${normalizedLimit}`;
    },
    mapRow: (row) => {
      const code = readStringField(row, ["transport_type_code"]);
      const description = readStringField(row, ["description"]);
      if (!code) return null;
      return {
        value: code,
        label: [code, description].filter(Boolean).join(" "),
        payload: {
          code,
          description
        }
      };
    }
  },
  "special-codes": {
    buildSql: ({ query, limit }) => {
      const normalizedQuery = normalizeLookupQuery(query);
      const normalizedLimit = normalizeLookupLimit(limit, 30, 100);
      const filters: string[] = [];
      if (normalizedQuery) {
        const pattern = toSqlPattern(normalizedQuery);
        filters.push(`(cat.cat_code ilike '${pattern}' or coalesce(cat.description, '') ilike '${pattern}')`);
      }
      const whereSql = filters.length > 0 ? `where ${filters.join(" and ")}` : "";
      return `select
cat.CAT_CODE,
cat.DESCRIPTION
from GNLD_CATEGORY cat
${whereSql}
order by cat.CAT_CODE
limit ${normalizedLimit}`;
    },
    mapRow: (row) => {
      const code = readStringField(row, ["cat_code", "CAT_CODE"]);
      const description = readStringField(row, ["description", "DESCRIPTION"]);
      if (!code) return null;
      return {
        value: code,
        label: [code, description].filter(Boolean).join(" "),
        payload: {
          code,
          description
        }
      };
    }
  }
};

function readStringField(row: Record<string, unknown>, keys: string[]): string | null {
  const entries = Object.entries(row);
  for (const key of keys) {
    const directValue = row[key];
    if (typeof directValue === "string" && directValue.trim()) {
      return directValue.trim();
    }

    const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLocaleLowerCase("en-US");
    const match = entries.find(([candidateKey]) =>
      candidateKey.replace(/[^a-z0-9]/gi, "").toLocaleLowerCase("en-US") === normalizedKey
    );
    const value = match?.[1];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function buildBasicAuthHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
}

let loginCache: {
  bearerToken: string;
  secretKey: string;
  expiresAt: number;
} | null = null;

function unwrapResultRows(result: unknown): Record<string, unknown>[] {
  if (!Array.isArray(result)) return [];

  const first = result[0];
  if (Array.isArray(first)) {
    return first.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  }

  return result.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

async function ensureLookupAuth(baseUrl: string): Promise<{ bearerToken: string; secretKey: string }> {
  if (env.uyumLookup.bearerToken.trim() && env.uyumLookup.secretKey.trim()) {
    return {
      bearerToken: env.uyumLookup.bearerToken.trim(),
      secretKey: env.uyumLookup.secretKey.trim()
    };
  }

  if (loginCache && loginCache.expiresAt > Date.now() + 60_000) {
    return {
      bearerToken: loginCache.bearerToken,
      secretKey: loginCache.secretKey
    };
  }

  if (!env.uyumLookup.user.trim() || !env.uyumLookup.password.trim()) {
    throw new Error("UYUM lookup login requires UYUM_LOOKUP_USER and UYUM_LOOKUP_PASSWORD");
  }

  const loginResponse = await fetch(`${baseUrl}/UyumApi/v1/GNL/UyumLogin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      username: env.uyumLookup.user.trim(),
      password: env.uyumLookup.password
    })
  });

  const rawBody = await loginResponse.text();
  let data: UyumLookupResponse;
  try {
    data = JSON.parse(rawBody) as UyumLookupResponse;
  } catch {
    throw new Error(`Uyum login invalid JSON response: ${rawBody.slice(0, 300)}`);
  }

  if (!loginResponse.ok || !data.result || typeof data.result !== "object") {
    throw new Error(`Uyum login HTTP ${loginResponse.status}: ${data.message ?? rawBody.slice(0, 300)}`);
  }

  const result = data.result as UyumLoginResult;
  const bearerToken = String(result.access_token ?? "").trim();
  const secretKey = String(result.uyumSecretKey ?? "").trim();
  const expiresIn = Number(result.expires_in ?? 0);

  if (!bearerToken || !secretKey) {
    throw new Error("Uyum login response did not include access_token and uyumSecretKey");
  }

  loginCache = {
    bearerToken,
    secretKey,
    expiresAt: Date.now() + Math.max(60, expiresIn || 3600) * 1000
  };

  return {
    bearerToken,
    secretKey
  };
}

async function executeLookupSql(sql: string): Promise<Record<string, unknown>[]> {
  const data = await postUyumRequest("/UyumApi/v1/GNL/NewExecuteWithSQL", {
    value: {
      cmdProcess: {
        commandType: "Text",
        commandText: sql,
        executeType: "ExecuteReader"
      }
    }
  });

  return unwrapResultRows(data.result);
}

export async function postUyumRequest(path: string, body: unknown): Promise<UyumLookupResponse> {
  const baseUrl = env.uyumLookup.baseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("UYUM_LOOKUP_BASE_URL not set");
  }

  const auth = await ensureLookupAuth(baseUrl);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${auth.bearerToken}`,
    UyumSecretKey: auth.secretKey
  };

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const response = await fetch(`${baseUrl}${normalizedPath}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  const rawBody = await response.text();
  let data: UyumLookupResponse;
  try {
    data = JSON.parse(rawBody) as UyumLookupResponse;
  } catch {
    throw new Error(`Uyum lookup invalid JSON response: ${rawBody.slice(0, 300)}`);
  }

  if (!response.ok) {
    const validationItems = Array.isArray(data.responseException?.validationErrors)
      ? data.responseException.validationErrors
          .map((item) => [item.field, item.message].filter(Boolean).join(": "))
          .filter(Boolean)
      : [];
    const baseMessage = data.responseException?.exceptionMessage
      || data.message
      || rawBody.slice(0, 300);
    const detail = validationItems.length > 0
      ? `${baseMessage}\n\nDoğrulama detayları:\n- ${validationItems.join("\n- ")}`
      : baseMessage;
    throw new Error(`Uyum lookup HTTP ${response.status}: ${detail}`);
  }

  return data;
}

export async function getLookupOptions(lookupKey: string, request: LookupRequest = {}): Promise<LookupOption[]> {
  const definition = LOOKUP_DEFINITIONS[lookupKey];
  if (!definition) {
    throw new Error(`Unknown lookup key: ${lookupKey}`);
  }

  const rows = await executeLookupSql(definition.buildSql(request));
  return rows
    .map((row) => definition.mapRow(row))
    .filter((item): item is LookupOption => Boolean(item));
}
