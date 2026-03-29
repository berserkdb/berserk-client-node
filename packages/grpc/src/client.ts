import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import * as path from "path";
import type {
  Config,
  QueryResponse,
  Table,
  Column,
  ColumnType,
  Value,
  ExecutionStats,
  QueryWarning,
  PartialFailure,
  VisualizationMetadata,
} from "./types";

const PROTO_DIR = path.resolve(__dirname, "../../proto");

const COLUMN_TYPE_MAP: Record<number, ColumnType> = {
  1: "bool",
  2: "int",
  3: "long",
  4: "real",
  5: "string",
  6: "datetime",
  7: "timespan",
  8: "guid",
  9: "dynamic",
};

/** gRPC client for the Berserk query service. */
export class GrpcClient {
  private config: Config;
  private client: any;

  constructor(config: Config) {
    this.config = {
      clientName: "berserk-client-node",
      ...config,
    };

    const packageDef = protoLoader.loadSync(
      [
        path.join(PROTO_DIR, "query.proto"),
        path.join(PROTO_DIR, "dynamic_value.proto"),
      ],
      {
        keepCase: true,
        longs: String,
        enums: Number,
        defaults: true,
        oneofs: true,
      },
    );
    const proto = grpc.loadPackageDefinition(packageDef) as any;
    this.client = new proto.query.QueryService(
      this.config.endpoint,
      grpc.credentials.createInsecure(),
    );
  }

  /** Execute a query and collect all results. */
  async query(
    query: string,
    since?: string,
    until?: string,
    timezone: string = "UTC",
  ): Promise<QueryResponse> {
    return new Promise((resolve, reject) => {
      const metadata = new grpc.Metadata();
      if (this.config.username) {
        metadata.set("x-bzrk-username", this.config.username);
      }
      if (this.config.clientName) {
        metadata.set("x-bzrk-client-name", this.config.clientName);
      }

      const deadline = new Date(Date.now() + 30000); // 30s timeout
      const call = this.client.ExecuteQuery(
        {
          query,
          since: since || "",
          until: until || "",
          timezone,
        },
        metadata,
        { deadline },
      );

      const tables: Table[] = [];
      let currentSchema: { name: string; columns: Column[] } | null = null;
      let currentRows: Value[][] = [];
      let stats: ExecutionStats | undefined;
      const warnings: QueryWarning[] = [];
      const partialFailures: PartialFailure[] = [];
      let visualization: VisualizationMetadata | undefined;

      call.on("data", (frame: any) => {
        const payload = frame.payload;
        if (!payload) return;

        if (payload === "schema") {
          // Flush previous table
          if (currentSchema) {
            tables.push({
              ...currentSchema,
              rows: currentRows,
            });
            currentRows = [];
          }
          currentSchema = {
            name: frame.schema.name,
            columns: frame.schema.columns.map((c: any) => ({
              name: c.name,
              type: COLUMN_TYPE_MAP[c.type] || "dynamic",
            })),
          };
        } else if (payload === "batch") {
          for (const row of frame.batch.rows || []) {
            currentRows.push((row.values || []).map(convertValue));
          }
        } else if (payload === "progress") {
          const p = frame.progress;
          stats = {
            rowsProcessed: Number(p.rows_processed || 0),
            chunksTotal: Number(p.chunks_total || 0),
            chunksScanned: Number(p.chunks_scanned || 0),
            queryTimeNanos: Number(p.query_time_nanos || 0),
            chunkScanTimeNanos: Number(p.chunk_scan_time_nanos || 0),
          };
        } else if (payload === "error") {
          const e = frame.error;
          reject(new Error(`Query error [${e.code}]: ${e.message || e.title}`));
        } else if (payload === "metadata") {
          const m = frame.metadata;
          for (const pf of m.partial_failures || []) {
            partialFailures.push({
              segmentIds: pf.segment_ids || [],
              message: pf.message || "",
            });
          }
          for (const w of m.warnings || []) {
            warnings.push({ kind: w.kind || "", message: w.message || "" });
          }
          if (m.visualization?.visualization_type) {
            visualization = {
              visualizationType: m.visualization.visualization_type,
              properties: m.visualization.properties || {},
            };
          }
        } else if (payload === "done") {
          // Will be handled in 'end'
        }
      });

      call.on("end", () => {
        if (currentSchema) {
          tables.push({ ...currentSchema, rows: currentRows });
        }
        resolve({ tables, stats, warnings, partialFailures, visualization });
      });

      call.on("error", (err: Error) => {
        reject(err);
      });
    });
  }

  /** Close the client connection. */
  close(): void {
    this.client.close();
  }
}

function convertValue(dyn: any): Value {
  if (!dyn || !dyn.value) return null;
  const key = dyn.value;
  if (key === "null_value") return null;
  if (key === "bool_value") return dyn.bool_value;
  if (key === "int_value") return Number(dyn.int_value);
  if (key === "long_value") return Number(dyn.long_value);
  if (key === "real_value") return dyn.real_value;
  if (key === "string_value") return dyn.string_value;
  if (key === "datetime_value") return Number(dyn.datetime_value);
  if (key === "timespan_value") return Number(dyn.timespan_value);
  if (key === "array_value") {
    return (dyn.array_value?.values || []).map(convertValue);
  }
  if (key === "bag_value") {
    const result: Record<string, Value> = {};
    for (const [k, v] of Object.entries(dyn.bag_value?.properties || {})) {
      result[k] = convertValue(v);
    }
    return result;
  }
  return null;
}
