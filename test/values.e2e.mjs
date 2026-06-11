// Validates that every BqlValue oneof arm in proto/dynamic_value.proto
// decodes through the real GrpcClient (@berserkdb/client-grpc) against a
// live cluster — one `print` query produces a column per value type, and
// each decoded cell is asserted.
//
// Set BERSERK_ENDPOINT to the gateway (e.g. localhost:9500) and
// BERSERK_TOKEN to a CLI bearer token. To run directly against a query
// service instead, set BERSERK_GRPC_PREFIX="".

import { strict as assert } from "assert";
import { GrpcClient } from "@berserkdb/client-grpc";

const ENDPOINT = process.env.BERSERK_ENDPOINT;
if (!ENDPOINT) {
  console.log("BERSERK_ENDPOINT not set, skipping value-type e2e tests");
  process.exit(0);
}

const GUID = "74be27de-1e4e-49d9-b579-fe0b331d3642";
// 2024-01-15T10:30:00Z. The server emits datetimes as nanoseconds since
// the Unix epoch (NOTE: proto comment claims ticks since 0001-01-01 —
// the wire disagrees; see test `datetime`).
const DT_UNIX_NANOS = Date.UTC(2024, 0, 15, 10, 30, 0) * 1e6;
// Timespans ARE emitted as 100ns ticks: 1h = 3600s * 1e7.
const TS_1H_TICKS = 3600 * 1e7;

// One column per BqlValue oneof arm, plus in-oneof default values
// (false / 0 / "") which proto3 oneof presence must keep distinguishable
// from null.
const QUERY = `print b = true,
  f = false,
  i = toint(42),
  l = tolong(1234567890123),
  z = tolong(0),
  r = 3.14,
  s = "hello",
  es = "",
  dt = todatetime("2024-01-15T10:30:00Z"),
  ts = 1h,
  g = toguid("${GUID}"),
  arr = dynamic([1, "two", true]),
  bag = dynamic({"a": 1, "nested": {"c": false}}),
  n = toint("not-a-number")`;

// column name → [expected column type, expected decoded value]
const EXPECTED = {
  b: ["bool", true],
  f: ["bool", false],
  i: ["int", 42],
  l: ["long", 1234567890123],
  z: ["long", 0],
  r: ["real", 3.14],
  s: ["string", "hello"],
  es: ["string", ""],
  dt: ["datetime", DT_UNIX_NANOS],
  ts: ["timespan", TS_1H_TICKS],
  // The proto enum has COLUMN_TYPE_GUID, but the engine reports
  // guid-typed expressions as string columns (values arrive on the
  // string_value arm). If the server ever starts emitting GUID,
  // this expectation should flip to "guid".
  g: ["string", GUID],
  arr: ["dynamic", [1, "two", true]],
  bag: ["dynamic", { a: 1, nested: { c: false } }],
  n: ["int", null],
};

const client = new GrpcClient({
  endpoint: ENDPOINT,
  token: process.env.BERSERK_TOKEN,
  ...(process.env.BERSERK_GRPC_PREFIX !== undefined
    ? { grpcPathPrefix: process.env.BERSERK_GRPC_PREFIX }
    : {}),
});

let passed = 0,
  failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}: ${e.message}`);
  }
}

try {
  const response = await client.query(QUERY);
  const table =
    response.tables.find((t) => t.name === "PrimaryResult") ?? response.tables[0];
  assert.ok(table, "no result table");
  assert.equal(table.rows.length, 1, `expected 1 row, got ${table.rows.length}`);
  const row = table.rows[0];

  console.log("value-type tests:");
  for (const [name, [expectedType, expectedValue]] of Object.entries(EXPECTED)) {
    check(name, () => {
      const idx = table.columns.findIndex((c) => c.name === name);
      assert.ok(idx >= 0, `column ${name} missing from schema`);
      assert.equal(
        table.columns[idx].type,
        expectedType,
        `column type for ${name}`,
      );
      assert.deepEqual(row[idx], expectedValue, `decoded value for ${name}`);
    });
  }

  // Precision guard: the client converts int64/uint64 wire values with
  // Number(). Unix-nanosecond datetimes (~1.7e18) sit far above
  // Number.MAX_SAFE_INTEGER (~9e15), so sub-microsecond precision is
  // silently rounded. This documents the limitation: a datetime with
  // non-zero nanoseconds must round-trip to within one ULP (~256 ns at
  // this magnitude) but cannot be expected to be exact.
  check("datetime_precision_documented", () => {
    const idx = table.columns.findIndex((c) => c.name === "dt");
    assert.ok(
      row[idx] > Number.MAX_SAFE_INTEGER,
      "datetime nanos exceed MAX_SAFE_INTEGER — keep this guard in sync if the wire unit changes",
    );
  });
} catch (e) {
  failed++;
  console.log(`  FAIL  query execution: ${e.message}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
client.close();
process.exit(failed > 0 ? 1 : 0);
