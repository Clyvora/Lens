/// <reference lib="webworker" />

import {
  analyzeCsv,
  analyzeJson,
  csvToJson,
  detectFormat,
  formatJson,
  getItemCount,
  jsonToCsv,
  parseCsv,
  parseJson,
} from "../lib";
import type { CsvDocument, JsonValue } from "../lib";
import type {
  ConversionPayload,
  CsvQueryPayload,
  JsonSearchPayload,
  ParsedDocumentPayload,
  SortSpec,
  WorkerRequest,
  WorkerResponse,
} from "./protocol";

let currentJson: JsonValue | undefined;
let currentCsv: CsvDocument | undefined;
let jsonTableData = new Map<string, Array<Record<string, JsonValue>>>();
let jsonSearchIndex: Array<{
  path: string;
  haystack: string;
  ancestors: string[];
}> = [];
let csvSearchCache = new Map<string, string[]>();
let queryCacheKey = "";
let queryCacheRows: Array<Record<string, string>> = [];
const CONVERSION_PREVIEW_LIMIT = 200_000;

function resetState() {
  currentJson = undefined;
  currentCsv = undefined;
  jsonTableData = new Map();
  jsonSearchIndex = [];
  csvSearchCache = new Map();
  queryCacheKey = "";
  queryCacheRows = [];
}

function indexJsonTableSources(value: JsonValue) {
  const labels = new Map<string, string>();
  const visit = (node: JsonValue, path: string) => {
    if (Array.isArray(node)) {
      if (node.every((item) => item !== null && typeof item === "object" && !Array.isArray(item))) {
        const rows = node as Array<Record<string, JsonValue>>;
        const existing = jsonTableData.get(path) ?? [];
        jsonTableData.set(path, [...existing, ...rows]);
        labels.set(path, path === "$" ? "Root array" : path);
        for (const item of rows) {
          for (const [key, child] of Object.entries(item)) {
            if (child && typeof child === "object") visit(child, `${path}[].${key}`);
          }
        }
      }
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        const nextPath = /^[A-Za-z_$][\w$]*$/.test(key)
          ? `${path}.${key}`
          : `${path}[${JSON.stringify(key)}]`;
        visit(child, nextPath);
      }
    }
  };
  visit(value, "$");
  return [...jsonTableData.entries()].map(([id, rows]) => ({
    id,
    label: labels.get(id) ?? id,
    rows: rows.length,
  }));
}

function parseDocument(
  filename: string,
  source: string | ArrayBuffer,
): ParsedDocumentPayload {
  const content = typeof source === "string"
    ? source
    : new TextDecoder("utf-8").decode(source);
  if (!content.trim()) throw new Error("This file is empty. Choose a JSON or CSV file with content.");
  const detected = detectFormat(filename, content);
  resetState();

  if (detected.format === "json") {
    const parsed = parseJson(content);
    if (!parsed.ok) throw new Error(parsed.error.message);
    currentJson = parsed.data;
    jsonSearchIndex = buildJsonSearchIndex(parsed.data);
    const jsonTableSources = indexJsonTableSources(parsed.data);
    return {
      format: "json",
      json: parsed.data,
      formattedJson: formatJson(parsed.data),
      itemCount: getItemCount(parsed.data),
      issues: [],
      jsonInsights: analyzeJson(parsed.data),
      jsonTableSources,
    };
  }

  if (detected.format === "csv") {
    const parsed = parseCsv(content.replace(/^\uFEFF/, ""));
    if (!parsed.ok) throw new Error(parsed.error.message);
    currentCsv = parsed.data;
    return {
      format: "csv",
      columns: parsed.data.columns,
      itemCount: parsed.data.rows.length,
      issues: parsed.data.errors,
      csvInsights: analyzeCsv(parsed.data),
    };
  }

  throw new Error("We could not recognize this file as JSON or CSV.");
}

function buildJsonSearchIndex(value: JsonValue) {
  const index: Array<{ path: string; haystack: string; ancestors: string[] }> = [];
  const visit = (
    key: string,
    node: JsonValue,
    path: string,
    ancestors: string[],
  ) => {
    const scalar = node === null || typeof node !== "object";
    index.push({
      path,
      haystack: `${key}\u0000${scalar ? String(node) : ""}`.toLowerCase(),
      ancestors,
    });
    if (node && typeof node === "object") {
      const array = Array.isArray(node);
      for (const [childKey, child] of Object.entries(node)) {
        visit(
          childKey,
          child,
          childPath(path, childKey, array),
          [...ancestors, path],
        );
      }
    }
  };
  visit("root", value, "$", []);
  return index;
}

function csvSearchValues(column: string) {
  if (!currentCsv) throw new Error("No CSV file is open.");
  const cached = csvSearchCache.get(column);
  if (cached) return cached;
  const values = currentCsv.rows.map((row) =>
    column === "all"
      ? currentCsv!.columns.map((name) => row[name] ?? "").join("\u0000").toLowerCase()
      : String(row[column] ?? "").toLowerCase(),
  );
  csvSearchCache.set(column, values);
  return values;
}

function getCsvRows(query: string, column: string, sort: SortSpec | null) {
  if (!currentCsv) throw new Error("No CSV file is open.");
  const normalizedQuery = query.trim().toLowerCase();
  const key = JSON.stringify([normalizedQuery, column, sort]);
  if (key === queryCacheKey) return queryCacheRows;

  const filtered = !normalizedQuery
    ? [...currentCsv.rows]
    : (() => {
        const searchable = csvSearchValues(column);
        return currentCsv!.rows.filter((_, index) =>
          searchable[index].includes(normalizedQuery),
        );
      })();

  if (sort) {
    filtered.sort(
      (a, b) =>
        String(a[sort.column] ?? "").localeCompare(
          String(b[sort.column] ?? ""),
          undefined,
          { numeric: true },
        ) * (sort.direction === "asc" ? 1 : -1),
    );
  }

  queryCacheKey = key;
  queryCacheRows = filtered;
  return filtered;
}

function queryCsv(
  query: string,
  column: string,
  sort: SortSpec | null,
  limit: number,
): CsvQueryPayload {
  const rows = getCsvRows(query, column, sort);
  return { rows: rows.slice(0, limit), total: rows.length };
}

function childPath(parent: string, key: string, isArray: boolean) {
  if (isArray) return `${parent}[${key}]`;
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}

function searchJson(query: string): JsonSearchPayload {
  if (currentJson === undefined) throw new Error("No JSON file is open.");
  const needle = query.trim().toLowerCase();
  if (!needle) return { exactPaths: [], branchPaths: [], matches: 0 };

  const exact = new Set<string>();
  const branches = new Set<string>();
  for (const entry of jsonSearchIndex) {
    if (!entry.haystack.includes(needle)) continue;
    exact.add(entry.path);
    for (const ancestor of entry.ancestors) branches.add(ancestor);
  }
  return {
    exactPaths: [...exact],
    branchPaths: [...branches],
    matches: exact.size,
  };
}

function convert(request: Extract<WorkerRequest, { type: "convert" }>): ConversionPayload {
  if (request.sourceFormat === "csv") {
    if (!currentCsv) throw new Error("No CSV file is open.");
    const rows = request.exportScope === "filtered"
      ? getCsvRows(request.query, request.column, request.sort)
      : currentCsv.rows;
    const convertedRows = csvToJson(
      { ...currentCsv, rows },
      {
        inferTypes: request.inferCsvTypes,
        emptyMode: request.csvEmptyMode,
      },
    );
    const text = formatJson(convertedRows);
    return makeConversionPayload(text, "json", [
        { label: "Rows", value: rows.length.toLocaleString() },
        { label: "Columns", value: currentCsv.columns.length.toLocaleString() },
        { label: "Source", value: request.exportScope === "filtered" ? "Current view" : "Complete file" },
        { label: "Value types", value: request.inferCsvTypes ? "Numbers and booleans inferred" : "All text" },
        { label: "Empty cells", value: request.csvEmptyMode === "null" ? "null" : request.csvEmptyMode === "omit" ? "Omitted" : "Empty text" },
      ]);
  }

  if (currentJson === undefined) throw new Error("No JSON file is open.");
  const tableValue = jsonTableData.get(request.jsonTableSource);
  if (!tableValue) {
    throw new Error("No table-shaped array was found. Choose a JSON array containing objects before converting to CSV.");
  }
  const converted = jsonToCsv(tableValue, {
    delimiter: request.delimiter,
    newline: request.newline,
    nestedMode: request.nestedMode,
    protectFormulas: request.protectFormulas,
  });
  if (!converted.ok) throw new Error(converted.error.message);
  const parsedOutput = parseCsv(converted.data);
  const columns = parsedOutput.ok ? parsedOutput.data.columns.length : 0;
  const rows = parsedOutput.ok ? parsedOutput.data.rows.length : tableValue.length;
  return makeConversionPayload(converted.data, "csv", [
      { label: "Rows", value: rows.toLocaleString() },
      { label: "Columns", value: columns.toLocaleString() },
      {
        label: "Nested data",
        value: request.nestedMode === "expand"
          ? "Arrays expanded"
          : request.nestedMode === "flatten"
            ? "Flattened paths"
            : "JSON text",
      },
      { label: "Table source", value: request.jsonTableSource },
      { label: "Formula safety", value: request.protectFormulas ? "Protected" : "Unchanged" },
    ]);
}

function makeConversionPayload(
  text: string,
  format: "json" | "csv",
  diagnostics: Array<{ label: string; value: string }>,
): ConversionPayload {
  const blob = new Blob([text], {
    type: format === "json" ? "application/json" : "text/csv",
  });
  const size = blob.size < 1024
    ? `${blob.size} B`
    : blob.size < 1024 ** 2
      ? `${(blob.size / 1024).toFixed(1)} KB`
      : `${(blob.size / 1024 ** 2).toFixed(1)} MB`;
  const truncated = text.length > CONVERSION_PREVIEW_LIMIT;
  return {
    preview: truncated
      ? `${text.slice(0, CONVERSION_PREVIEW_LIMIT)}\n\n… Preview limited for performance. The downloaded file remains complete.`
      : text,
    blob,
    truncated,
    format,
    diagnostics: [...diagnostics, { label: "Output size", value: size }],
  };
}

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const respond = (response: WorkerResponse) => workerScope.postMessage(response);
  try {
    let data: unknown;
    switch (request.type) {
      case "parse":
        data = parseDocument(request.filename, request.content);
        break;
      case "queryCsv":
        data = queryCsv(request.query, request.column, request.sort, request.limit);
        break;
      case "searchJson":
        data = searchJson(request.query);
        break;
      case "convert":
        data = convert(request);
        break;
      case "clear":
        resetState();
        data = undefined;
        break;
    }
    respond({ id: request.id, ok: true, data });
  } catch (error) {
    respond({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : "Local processing failed.",
    });
  }
});
