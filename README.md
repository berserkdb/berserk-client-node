# berserk-client-node

Node.js client libraries for the [Berserk](https://berserk.dev) observability platform.

Clients connect to the **gateway** — the authenticated public edge — using a
bearer token (a CLI access token from the device flow, or a service-principal
token). The gateway authenticates the call and injects the trusted identity
before forwarding to the query service.

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

const client = new GrpcClient({
  endpoint: "https://berserk.example.com",
  token: process.env.BERSERK_TOKEN,
});
const response = await client.query("Logs | where severity == 'error' | take 10");

for (const table of response.tables) {
  console.log(`Table: ${table.name} (${table.rows.length} rows)`);
}

client.close();
```

The gateway mounts the gRPC surface under `/api/grpc`; the client applies
that prefix by default. When connecting directly to a query service
(in-cluster / dev), disable it with `grpcPathPrefix: ""`.

### HTTP (ADX v2)

```bash
npm install @berserkdb/client-http
```

```typescript
import { HttpClient } from "@berserkdb/client-http";

const client = new HttpClient({
  endpoint: "https://berserk.example.com",
  token: process.env.BERSERK_TOKEN,
});
const response = await client.query("print v = 1");
console.log(response.tables);
```

## License

Apache-2.0
