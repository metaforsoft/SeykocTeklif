import { Pool } from "pg";
import { env } from "./env";

export const erpPool = new Pool({
  host: env.erp.host,
  port: env.erp.port,
  database: env.erp.database,
  user: env.erp.user,
  password: env.erp.password,
  max: 5,
  idleTimeoutMillis: 30000
});

export const matchPool = new Pool({
  host: env.match.host,
  port: env.match.port,
  database: env.match.database,
  user: env.match.user,
  password: env.match.password,
  max: 10,
  idleTimeoutMillis: 30000
});
