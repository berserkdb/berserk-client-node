// End-to-end tests against a live Berserk cluster.
// Set BERSERK_ENDPOINT to run (e.g., BERSERK_ENDPOINT=http://localhost:9510).
//
// To run through a gateway (the authenticated public edge) instead of
// directly against the query service:
//   BERSERK_TOKEN        CLI bearer token (gateway device flow)
//   BERSERK_GRPC_PREFIX  path prefix the gateway mounts gRPC under
//                        (e.g. /api/grpc)

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import * as path from "path";
import { fileURLToPath } from "url";
import { strict as assert } from "assert";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENDPOINT = process.env.BERSERK_ENDPOINT;
const TOKEN = process.env.BERSERK_TOKEN;
const GRPC_PREFIX = process.env.BERSERK_GRPC_PREFIX ?? "";

if (!ENDPOINT) {
  console.log("BERSERK_ENDPOINT not set, skipping e2e tests");
  process.exit(0);
}

const GRPC_TARGET = ENDPOINT.replace(/^https?:\/\//, "");
const HTTP_TARGET = ENDPOINT.startsWith("http") ? ENDPOINT : `http://${ENDPOINT}`;

// Load protos
const PROTO_DIR = path.resolve(__dirname, "..", "proto");
const packageDef = protoLoader.loadSync(
  [
    path.join(PROTO_DIR, "query.proto"),
    path.join(PROTO_DIR, "common_api.proto"),
    path.join(PROTO_DIR, "dynamic_value.proto"),
  ],
  { keepCase: true, longs: String, enums: Number, defaults: true, oneofs: true }
);
// Gateways mount the gRPC surface under a path prefix (e.g.
// /api/grpc/query.QueryService/ExecuteQuery). grpc-js derives method
// paths from the package definition, so rewrite them before building
// the client.
if (GRPC_PREFIX) {
  for (const def of Object.values(packageDef)) {
    for (const method of Object.values(def)) {
      if (method && typeof method.path === "string") method.path = GRPC_PREFIX + method.path;
    }
  }
}
const proto = grpc.loadPackageDefinition(packageDef);
const client = new proto.query.QueryService(GRPC_TARGET, grpc.credentials.createInsecure());

function authMetadata() {
  const md = new grpc.Metadata();
  if (TOKEN) md.set("authorization", `Bearer ${TOKEN}`);
  return md;
}

function grpcQuery(csl) {
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + 30000);
    const call = client.ExecuteQuery({ query: csl, since: "", until: "", timezone: "UTC", database: { name: "default" } }, authMetadata(), { deadline });
    const tables = []; let schema = null; let rows = [];
    call.on("data", f => {
      const p = f.payload;
      if (p === "schema") {
        if (schema) { tables.push({ ...schema, rows }); rows = []; }
        schema = { name: f.schema.name, columns: f.schema.columns.map(c => ({ name: c.name, type: c.type })) };
      } else if (p === "batch") {
        for (const r of f.batch.rows || []) {
          rows.push((r.values || []).map(v => {
            if (!v || !v.value) return null;
            const k = v.value;
            if (k === "null_value") return null;
            if (k === "long_value") return Number(v.long_value);
            if (k === "string_value") return v.string_value;
            if (k === "bool_value") return v.bool_value;
            if (k === "real_value") return v.real_value;
            if (k === "int_value") return Number(v.int_value);
            return v[k];
          }));
        }
      } else if (p === "error") { reject(new Error(`[${f.error.code}]: ${f.error.message || f.error.title}`)); }
    });
    call.on("end", () => { if (schema) tables.push({ ...schema, rows }); resolve({ tables }); });
    call.on("error", reject);
  });
}

let passed = 0, failed = 0;
async function run(name, fn) {
  try { await fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL  ${name}: ${e.message}`); }
}

console.log("gRPC tests:");
await run("simple_query", async () => {
  const r = await grpcQuery("print v = 1");
  assert.equal(r.tables.length, 1);
  assert.equal(r.tables[0].rows.length, 1);
  assert.equal(r.tables[0].columns[0].name, "v");
  assert.deepEqual(r.tables[0].rows[0], [1]);
});
await run("invalid_query", async () => {
  await assert.rejects(() => grpcQuery("this is not valid kql!!!"));
});
await run("multi_column", async () => {
  const r = await grpcQuery('print a = 1, b = "hello", c = true');
  assert.equal(r.tables[0].columns.length, 3);
  assert.equal(r.tables[0].columns[0].name, "a");
  assert.equal(r.tables[0].columns[1].name, "b");
  assert.equal(r.tables[0].columns[2].name, "c");
  assert.deepEqual(r.tables[0].rows[0], [1, "hello", true]);
});

const httpHeaders = {
  "Content-Type": "application/json",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

console.log("\nHTTP tests:");
await run("simple_query", async () => {
  const resp = await fetch(`${HTTP_TARGET}/v2/rest/query`, {
    method: "POST", headers: httpHeaders,
    body: JSON.stringify({ db: "default", csl: "print v = 1" }),
  });
  assert.equal(resp.status, 200);
  const frames = await resp.json();
  const primary = frames.find(f => f.FrameType === "DataTable" && f.TableKind === "PrimaryResult");
  assert.ok(primary, "no PrimaryResult frame");
  assert.equal(primary.Rows.length, 1);
  assert.deepEqual(primary.Rows[0], [1]);
});
await run("invalid_query", async () => {
  const resp = await fetch(`${HTTP_TARGET}/v2/rest/query`, {
    method: "POST", headers: httpHeaders,
    body: JSON.stringify({ db: "default", csl: "this is not valid kql!!!" }),
  });
  assert.ok(resp.status >= 400, `expected 4xx, got ${resp.status}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
client.close();
process.exit(failed > 0 ? 1 : 0);
