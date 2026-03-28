import type {
  Config,
  QueryResponse,
  Table,
  Column,
  ColumnType,
  Value,
} from "./types";

interface V2Frame {
  FrameType: string;
  TableKind?: string;
  TableName?: string;
  Columns?: { ColumnName: string; ColumnType: string }[];
  Rows?: any[][];
  HasErrors?: boolean;
}

const COLUMN_TYPE_MAP: Record<string, ColumnType> = {
  bool: "bool",
  int: "int",
  long: "long",
  real: "real",
  double: "real",
  string: "string",
  datetime: "datetime",
  timespan: "timespan",
  guid: "guid",
  uuid: "guid",
  dynamic: "dynamic",
};

/** HTTP client for the Berserk ADX v2 REST endpoint. */
export class HttpClient {
  private config: Config;

  constructor(config: Config) {
    this.config = {
      clientName: "berserk-client-node",
      ...config,
    };
  }

  /** Execute a query via the ADX v2 REST endpoint. */
  async query(query: string): Promise<QueryResponse> {
    const endpoint = this.config.endpoint.startsWith("http")
      ? this.config.endpoint
      : `http://${this.config.endpoint}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.username) {
      headers["x-bzrk-username"] = this.config.username;
    }
    if (this.config.clientName) {
      headers["x-bzrk-client-name"] = this.config.clientName;
    }

    const resp = await fetch(`${endpoint}/v2/rest/query`, {
      method: "POST",
      headers,
      body: JSON.stringify({ csl: query }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${body}`);
    }

    const frames: V2Frame[] = await resp.json();
    const tables: Table[] = [];
    let hasErrors = false;

    for (const frame of frames) {
      if (
        frame.FrameType === "DataTable" &&
        frame.TableKind === "PrimaryResult"
      ) {
        const columns: Column[] = (frame.Columns || []).map((c) => ({
          name: c.ColumnName,
          type: COLUMN_TYPE_MAP[c.ColumnType] || "dynamic",
        }));
        const rows: Value[][] = (frame.Rows || []).map((row) =>
          row.map(convertJsonValue)
        );
        tables.push({ name: frame.TableName || "PrimaryResult", columns, rows });
      } else if (frame.FrameType === "DataSetCompletion") {
        hasErrors = frame.HasErrors || false;
      }
    }

    if (hasErrors) {
      throw new Error("Query completed with errors");
    }

    return {
      tables,
      warnings: [],
      partialFailures: [],
    };
  }
}

function convertJsonValue(v: any): Value {
  return v; // JSON values map directly to our Value type
}
