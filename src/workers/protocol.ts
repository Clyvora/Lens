import type {
  CsvColumnInsight,
  CsvDelimiter,
  CsvLineEnding,
  JsonInsights,
  JsonValue,
  NestedJsonMode,
  ParseIssue,
} from "../lib";

export interface SortSpec {
  column: string;
  direction: "asc" | "desc";
}

export interface ParsedDocumentPayload {
  format: "json" | "csv";
  json?: JsonValue;
  formattedJson?: string;
  columns?: string[];
  itemCount: number;
  issues: ParseIssue[];
  csvInsights?: {
    columns: CsvColumnInsight[];
    totalEmptyCells: number;
    duplicateRows: number;
  };
  jsonInsights?: JsonInsights;
}

export interface CsvQueryPayload {
  rows: Array<Record<string, string>>;
  total: number;
}

export interface JsonSearchPayload {
  exactPaths: string[];
  branchPaths: string[];
  matches: number;
}

export interface ConversionPayload {
  preview: string;
  blob: Blob;
  truncated: boolean;
  format: "json" | "csv";
  diagnostics: Array<{ label: string; value: string }>;
}

export type WorkerRequest =
  | { id: number; type: "parse"; filename: string; content: string | ArrayBuffer }
  | {
      id: number;
      type: "queryCsv";
      query: string;
      column: string;
      sort: SortSpec | null;
      limit: number;
    }
  | { id: number; type: "searchJson"; query: string }
  | {
      id: number;
      type: "convert";
      sourceFormat: "json" | "csv";
      exportScope: "all" | "filtered";
      query: string;
      column: string;
      sort: SortSpec | null;
      delimiter: CsvDelimiter;
      newline: CsvLineEnding;
      nestedMode: NestedJsonMode;
      protectFormulas: boolean;
    }
  | { id: number; type: "clear" };

export interface WorkerResponse<T = unknown> {
  id: number;
  ok: boolean;
  data?: T;
  error?: string;
}
