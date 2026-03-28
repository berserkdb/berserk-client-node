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
  /** Query service endpoint (e.g., "localhost:9510") */
  endpoint: string;
  /** Username sent as x-bzrk-username header */
  username?: string;
  /** Client name sent as x-bzrk-client-name header */
  clientName?: string;
}
