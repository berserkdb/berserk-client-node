# berserk-client-node

Node.js client libraries for the [Berserk](https://berserk.dev) observability platform.

## Packages

| Package | Description |
|---------|-------------|
| [`@berserkdb/client-grpc`](packages/grpc) | gRPC streaming client |
| [`@berserkdb/client-http`](packages/http) | HTTP client (ADX v2 REST) |

## Quick Start

### gRPC

```bash
npm install @berserkdb/client-grpc
```

```typescript
import { GrpcClient } from "@berserkdb/client-grpc";

const client = new GrpcClient({ endpoint: "localhost:9510" });
const response = await client.query("Logs | where severity == 'error' | take 10");

for (const table of response.tables) {
  console.log(`Table: ${table.name} (${table.rows.length} rows)`);
}

client.close();
```

### HTTP (ADX v2)

```bash
npm install @berserkdb/client-http
```

```typescript
import { HttpClient } from "@berserkdb/client-http";

const client = new HttpClient({ endpoint: "http://localhost:9510" });
const response = await client.query("print v = 1");
console.log(response.tables);
```

## License

Apache-2.0
