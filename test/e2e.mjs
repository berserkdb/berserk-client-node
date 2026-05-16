// End-to-end tests against a live Berserk cluster.
// Set BERSERK_ENDPOINT to run (e.g., BERSERK_ENDPOINT=http://localhost:9510).

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import * as path from "path";
import { fileURLToPath } from "url";
import { strict as assert } from "assert";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENDPOINT = process.env.BERSERK_ENDPOINT;

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
const proto = grpc.loadPackageDefinition(packageDef);
const client = new proto.query.QueryService(GRPC_TARGET, grpc.credentials.createInsecure());

function grpcQuery(csl) {
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + 30000);
    const call = client.ExecuteQuery({ query: csl, since: "", until: "", timezone: "UTC", database: { name: "default" } }, new grpc.Metadata(), { deadline });
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
            if (k === "tt_null") return null;
            if (k === "tt_long") return Number(v.tt_long);
            if (k === "tt_string") return v.tt_string;
            if (k === "tt_bool") return v.tt_bool;
            if (k === "tt_double") return v.tt_double;
            if (k === "tt_int") return Number(v.tt_int);
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

console.log("\nHTTP tests:");
await run("simple_query", async () => {
  const resp = await fetch(`${HTTP_TARGET}/v2/rest/query`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ csl: "print v = 1" }),
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
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ csl: "this is not valid kql!!!" }),
  });
  assert.ok(resp.status >= 400, `expected 4xx, got ${resp.status}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
client.close();
process.exit(failed > 0 ? 1 : 0);
