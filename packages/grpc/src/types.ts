/** Complete query response. */
export interface QueryResponse {
  tables: Table[];
  stats?: ExecutionStats;
  warnings: QueryWarning[];
  partialFailures: PartialFailure[];
  visualization?: VisualizationMetadata;
}

/** A result table with schema and rows. */
export interface Table {
  name: string;
  columns: Column[];
  rows: Value[][];
}

/** Column definition. */
export interface Column {
  name: string;
  type: ColumnType;
}

/** Column data types. */
export type ColumnType =
  | "bool"
  | "int"
  | "long"
  | "real"
  | "string"
  | "datetime"
  | "timespan"
  | "guid"
  | "dynamic";

/** A dynamic value from query results. */
export type Value =
  | null
  | boolean
  | number
  | string
  | Value[]
  | { [key: string]: Value };

/** Query execution statistics. */
export interface ExecutionStats {
  rowsProcessed: number;
  chunksTotal: number;
  chunksScanned: number;
  queryTimeNanos: number;
  chunkScanTimeNanos: number;
}

/** A warning from query execution. */
export interface QueryWarning {
  kind: string;
  message: string;
}

/** Partial failure info. */
export interface PartialFailure {
  segmentIds: string[];
  message: string;
}

/** Visualization metadata from render operator. */
export interface VisualizationMetadata {
  visualizationType: string;
  properties: Record<string, string>;
}

/** Client configuration. */
export interface Config {
  /** Gateway endpoint (e.g., "https://berserk.example.com" or
   * "localhost:9500"). An https endpoint uses TLS channel credentials. */
  endpoint: string;
  /** Bearer token sent as `authorization` metadata on every call —
   * a CLI access token or service-principal token minted by the
   * gateway. Unauthenticated calls are rejected by the gateway. */
  token?: string;
  /** Path prefix the gateway mounts the gRPC surface under. Defaults
   * to "/api/grpc". Set to "" when connecting directly to a query
   * service (in-cluster / dev). */
  grpcPathPrefix?: string;
  /**
   * Database to resolve unqualified table names against. Sent on every
   * ExecuteQueryRequest as `database.name`. Defaults to "default".
   */
  database?: string;
}
