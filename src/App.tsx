import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChangeEvent, DragEvent } from "react";
import {
  Check,
  ChevronDown,
  Clipboard,
  Database,
  Download,
  FileJson2,
  FileSpreadsheet,
  FolderOpen,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { CsvTable } from "./components/CsvTable";
import { JsonTree } from "./components/JsonTree";
import { DataWorkerClient } from "./lib/dataWorkerClient";
import type {
  CsvColumnInsight,
  CsvDelimiter,
  CsvLineEnding,
  JsonInsights,
  JsonValue,
  NestedJsonMode,
  ParseIssue,
} from "./lib";
import type {
  ConversionPayload,
  CsvQueryPayload,
  JsonSearchPayload,
  ParsedDocumentPayload,
} from "./workers/protocol";
import "./App.css";

type Format = "json" | "csv";

interface DocumentState {
  name: string;
  size: number;
  format: Format;
  sourceBlob: Blob;
  json?: JsonValue;
  formattedJson?: string;
  columns?: string[];
  issues?: ParseIssue[];
  itemCount: number;
  csvInsights?: {
    columns: CsvColumnInsight[];
    totalEmptyCells: number;
    duplicateRows: number;
  };
  jsonInsights?: JsonInsights;
}

const JSON_EXAMPLE = `{
  "project": "Clyvora Lens",
  "private": true,
  "features": ["inspect", "search", "convert"],
  "settings": { "theme": "midnight", "localOnly": true },
  "version": 1
}`;

const CSV_EXAMPLE = `name,category,status,notes
Atlas,Design,Active,"Grid, orbit, and type"
Beacon,Research,Paused,"Said ""keep it local"""
Morrow,Engineering,Active,
Lumen,Operations,Review,"Ready for inspection"`;

const LARGE_FILE_BYTES = 10 * 1024 * 1024;
const CSV_PAGE_SIZE = 200;
const PREFERENCES_KEY = "clyvora-lens-preferences";

interface Preferences {
  jsonView: "tree" | "raw";
  showJsonPaths: boolean;
  delimiter: CsvDelimiter;
  newline: CsvLineEnding;
  nestedMode: NestedJsonMode;
  protectFormulas: boolean;
  exportScope: "all" | "filtered";
}

const DEFAULT_PREFERENCES: Preferences = {
  jsonView: "tree",
  showJsonPaths: false,
  delimiter: ",",
  newline: "\n",
  nestedMode: "stringify",
  protectFormulas: true,
  exportScope: "all",
};

let dataWorker = new DataWorkerClient();
if (import.meta.hot) {
  import.meta.hot.dispose(() => dataWorker.dispose());
}

function loadPreferences(): Preferences {
  try {
    const stored = globalThis.localStorage?.getItem(PREFERENCES_KEY);
    return stored
      ? { ...DEFAULT_PREFERENCES, ...JSON.parse(stored) }
      : DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadText(text: string, filename: string, type: string) {
  downloadBlob(new Blob([text], { type }), filename);
}

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

const LargeTextView = memo(function LargeTextView({
  content,
  label,
}: {
  content: string;
  label: string;
}) {
  return (
    <textarea
      className="raw-view raw-textarea"
      value={content}
      readOnly
      wrap="off"
      spellCheck={false}
      aria-label={label}
    />
  );
});

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const readRequestRef = useRef(0);
  const loadRequestRef = useRef(0);
  const csvRequestRef = useRef(0);
  const jsonSearchRequestRef = useRef(0);
  const conversionRequestRef = useRef(0);
  const [document, setDocument] = useState<DocumentState | null>(null);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState("");
  const [dragging, setDragging] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences);
  const [query, setQuery] = useState("");
  const [workerQuery, setWorkerQuery] = useState("");
  const [filterColumn, setFilterColumn] = useState("all");
  const [visibleCsvRows, setVisibleCsvRows] = useState(CSV_PAGE_SIZE);
  const [csvView, setCsvView] = useState<CsvQueryPayload>({ rows: [], total: 0 });
  const [csvQueryPending, setCsvQueryPending] = useState(false);
  const [jsonSearch, setJsonSearch] = useState<{
    exactPaths: ReadonlySet<string>;
    branchPaths: ReadonlySet<string>;
    matches: number;
  }>({ exactPaths: new Set(), branchPaths: new Set(), matches: 0 });
  const [jsonSearchPending, setJsonSearchPending] = useState(false);
  const searchPending =
    query !== workerQuery || csvQueryPending || jsonSearchPending;
  const [sort, setSort] = useState<{
    column: string;
    direction: "asc" | "desc";
  } | null>(null);
  const [conversion, setConversion] = useState<
    (ConversionPayload & { name: string }) | null
  >(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [conversionBusy, setConversionBusy] = useState(false);

  const clearSearch = useCallback(() => {
    setQuery("");
    setWorkerQuery("");
  }, []);

  const closeConversion = useCallback(() => {
    conversionRequestRef.current += 1;
    setConversionBusy(false);
    setConversion(null);
  }, []);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(
        PREFERENCES_KEY,
        JSON.stringify(preferences),
      );
    } catch {
      // Preferences are optional; file contents are never stored.
    }
  }, [preferences]);

  useEffect(() => {
    const timeout = globalThis.setTimeout(() => setWorkerQuery(query), 140);
    return () => globalThis.clearTimeout(timeout);
  }, [query]);

  const conversionOpen = Boolean(conversion);
  const pendingFileOpen = Boolean(pendingFile);

  useEffect(() => {
    const onShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        if (!conversionOpen && !pendingFileOpen) inputRef.current?.click();
        return;
      }
      if (
        document &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (
        event.key === "Escape" &&
        query &&
        !conversionOpen &&
        !pendingFileOpen
      ) {
        clearSearch();
        searchInputRef.current?.focus();
      }
    };
    globalThis.document.addEventListener("keydown", onShortcut);
    return () => globalThis.document.removeEventListener("keydown", onShortcut);
  }, [clearSearch, conversionOpen, document, pendingFileOpen, query]);

  useEffect(() => {
    if (!conversionOpen && !pendingFileOpen) return;
    previousFocusRef.current = globalThis.document
      .activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, input, select, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => !element.hasAttribute("disabled"));
    focusable()[0]?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeConversion();
        setPendingFile(null);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && globalThis.document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        globalThis.document.activeElement === last
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    globalThis.document.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [closeConversion, conversionOpen, pendingFileOpen]);

  const resetInspectionState = () => {
    clearSearch();
    setFilterColumn("all");
    setSort(null);
    setConversion(null);
    setCopyState("idle");
    setCsvView({ rows: [], total: 0 });
    setJsonSearch({ exactPaths: new Set(), branchPaths: new Set(), matches: 0 });
  };

  const closeDocument = () => {
    readRequestRef.current += 1;
    loadRequestRef.current += 1;
    csvRequestRef.current += 1;
    jsonSearchRequestRef.current += 1;
    conversionRequestRef.current += 1;
    dataWorker.dispose();
    dataWorker = new DataWorkerClient();
    setDocument(null);
    setError("");
    setProcessing("");
    setConversionBusy(false);
    resetInspectionState();
  };

  const loadSource = async (
    name: string,
    content: string | ArrayBuffer,
    sourceBlob: Blob,
    transfer: Transferable[] = [],
  ) => {
    const requestId = ++loadRequestRef.current;
    csvRequestRef.current += 1;
    jsonSearchRequestRef.current += 1;
    conversionRequestRef.current += 1;
    dataWorker.dispose();
    dataWorker = new DataWorkerClient();
    setDocument(null);
    setConversionBusy(false);
    resetInspectionState();
    setProcessing("Inspecting locally…");
    setError("");
    try {
      const payload = await dataWorker.request<ParsedDocumentPayload>({
        type: "parse",
        filename: name,
        content,
      }, transfer);
      if (requestId !== loadRequestRef.current) return;
      setDocument({ name, size: sourceBlob.size, sourceBlob, ...payload });
      setError("");
    } catch (cause) {
      if (requestId !== loadRequestRef.current) return;
      setDocument(null);
      setError(
        cause instanceof Error
          ? cause.message
          : "This file could not be opened.",
      );
    } finally {
      if (requestId === loadRequestRef.current) setProcessing("");
    }
  };

  const loadContent = (name: string, content: string) => {
    readRequestRef.current += 1;
    const blob = new Blob([content], { type: "text/plain" });
    return loadSource(name, content, blob);
  };

  const readFile = async (file: File) => {
    if (!/\.(json|csv|txt)$/i.test(file.name)) {
      setError("Unsupported file type. Choose a .json, .csv, or .txt file.");
      return;
    }
    if (file.size > LARGE_FILE_BYTES) {
      setPendingFile(file);
      return;
    }
    setDocument(null);
    resetInspectionState();
    setProcessing("Reading file…");
    const readRequestId = ++readRequestRef.current;
    try {
      const buffer = await file.arrayBuffer();
      if (readRequestId !== readRequestRef.current) return;
      await loadSource(file.name, buffer, file, [buffer]);
    } catch {
      if (readRequestId !== readRequestRef.current) return;
      setProcessing("");
      setError("The file could not be read. It may be unavailable or damaged.");
    }
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) readFile(file);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) readFile(file);
  };

  useEffect(() => setVisibleCsvRows(CSV_PAGE_SIZE), [
    document,
    workerQuery,
    filterColumn,
    sort,
  ]);

  useEffect(() => {
    if (document?.format !== "csv") return;
    const requestId = ++csvRequestRef.current;
    setCsvQueryPending(true);
    dataWorker
      .request<CsvQueryPayload>({
        type: "queryCsv",
        query: workerQuery,
        column: filterColumn,
        sort,
        limit: visibleCsvRows,
      })
      .then((result) => {
        if (requestId === csvRequestRef.current) setCsvView(result);
      })
      .catch((cause) => {
        if (requestId === csvRequestRef.current)
          setError(cause instanceof Error ? cause.message : "Could not filter this CSV.");
      })
      .finally(() => {
        if (requestId === csvRequestRef.current) setCsvQueryPending(false);
      });
  }, [document, filterColumn, sort, visibleCsvRows, workerQuery]);

  useEffect(() => {
    if (document?.format !== "json") return;
    const requestId = ++jsonSearchRequestRef.current;
    if (!workerQuery.trim()) {
      setJsonSearch({ exactPaths: new Set(), branchPaths: new Set(), matches: 0 });
      setJsonSearchPending(false);
      return;
    }
    setJsonSearchPending(true);
    dataWorker
      .request<JsonSearchPayload>({ type: "searchJson", query: workerQuery })
      .then((result) => {
        if (requestId !== jsonSearchRequestRef.current) return;
        setJsonSearch({
          exactPaths: new Set(result.exactPaths),
          branchPaths: new Set(result.branchPaths),
          matches: result.matches,
        });
      })
      .catch((cause) => {
        if (requestId === jsonSearchRequestRef.current)
          setError(cause instanceof Error ? cause.message : "Could not search this JSON.");
      })
      .finally(() => {
        if (requestId === jsonSearchRequestRef.current) setJsonSearchPending(false);
      });
  }, [document, workerQuery]);

  const cycleSort = useCallback((column: string) => {
    setSort((current) =>
      !current || current.column !== column
        ? { column, direction: "asc" }
        : current.direction === "asc"
          ? { column, direction: "desc" }
          : null,
    );
  }, []);

  const showMoreCsvRows = useCallback(
    () => setVisibleCsvRows((count) => count + CSV_PAGE_SIZE),
    [],
  );

  const formattedJson = document?.formattedJson ?? "";
  const itemCount = document?.itemCount ?? 0;
  const csvInsights = document?.csvInsights ?? null;
  const jsonInsights = document?.jsonInsights ?? null;
  const csvIssueSummary = useMemo(() => {
    if (document?.format !== "csv" || !document.issues?.length) return [];
    const grouped = new Map<string, { message: string; count: number }>();
    for (const issue of document.issues) {
      const key = issue.code ?? issue.message;
      const existing = grouped.get(key);
      if (existing) existing.count += 1;
      else grouped.set(key, { message: issue.message, count: 1 });
    }
    return [...grouped.values()];
  }, [document]);

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(formattedJson);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    setTimeout(() => setCopyState("idle"), 1800);
  };

  const downloadOriginal = () => {
    if (!document) return;
    const name = `${baseName(document.name)}.${document.format}`;
    if (document.format === "json")
      downloadText(formattedJson, name, "application/json");
    else downloadBlob(document.sourceBlob, name);
  };

  const convert = async (nextPreferences: Preferences = preferences) => {
    if (!document) return;
    const requestId = ++conversionRequestRef.current;
    setConversionBusy(true);
    setError("");
    try {
      const result = await dataWorker.request<ConversionPayload>({
        type: "convert",
        sourceFormat: document.format,
        exportScope: nextPreferences.exportScope,
        query: workerQuery,
        column: filterColumn,
        sort,
        delimiter: nextPreferences.delimiter,
        newline: nextPreferences.newline,
        nestedMode: nextPreferences.nestedMode,
        protectFormulas: nextPreferences.protectFormulas,
      });
      if (requestId !== conversionRequestRef.current) return;
      setConversion({
        ...result,
        name: `${baseName(document.name)}.${result.format}`,
      });
    } catch (cause) {
      if (requestId === conversionRequestRef.current)
        setError(cause instanceof Error ? cause.message : "Could not convert this file.");
    } finally {
      if (requestId === conversionRequestRef.current) setConversionBusy(false);
    }
  };

  const updateConversionPreference = (patch: Partial<Preferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    void convert(next);
  };

  return (
    <main>
      <div className="ambient" aria-hidden="true">
        <i className="orbit orbit-one" />
        <i className="orbit orbit-two" />
        <i className="glow glow-one" />
        <i className="glow glow-two" />
      </div>
      <header className="topbar">
        <a href="#workspace" className="brand" aria-label="Clyvora Lens home">
          <span className="brand-mark">C</span>
          <span>
            Clyvora <em>Lens</em>
          </span>
          <span className="beta-badge">Beta</span>
        </a>
        <div className="privacy">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>Your files never leave this device.</span>
        </div>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">
            <Sparkles size={15} aria-hidden="true" /> Local file workbench
          </p>
          <h1 id="page-title">
            Look closer at
            <br />
            <em>your data.</em>
          </h1>
          <p className="lede">
            Open, inspect, search, and convert JSON or CSV—entirely in your
            browser.
          </p>
          <p className="local-promise">
            <ShieldCheck size={15} aria-hidden="true" /> Your files never leave
            this device.
          </p>
        </div>
        <div
          className={`drop-zone ${dragging ? "is-dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          aria-label="Drop a JSON, CSV, or text file here, or use the Choose file button"
        >
          <div className="drop-icon">
            <FolderOpen size={26} aria-hidden="true" />
          </div>
          <div>
            <strong>Drop a file to inspect</strong>
            <span>JSON, CSV, or TXT · processed locally</span>
          </div>
          <button
            type="button"
            className="primary"
            aria-keyshortcuts="Control+O Meta+O"
            onClick={(event) => {
              event.stopPropagation();
              inputRef.current?.click();
            }}
          >
            Choose file
          </button>
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept=".json,.csv,.txt,application/json,text/csv,text/plain"
            onChange={onFile}
          />
          <div className="example-row">
            <span>Or start with</span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                loadContent("example.json", JSON_EXAMPLE);
              }}
            >
              <FileJson2 size={14} /> JSON example
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                loadContent("example.csv", CSV_EXAMPLE);
              }}
            >
              <FileSpreadsheet size={14} /> CSV example
            </button>
          </div>
        </div>
      </section>

      <section
        id="workspace"
        className={`workspace ${document ? "has-document" : ""}`}
        aria-labelledby="workspace-title"
      >
        <div className="workspace-head">
          <div>
            <p className="eyebrow">Inspector</p>
            <h2 id="workspace-title">
              {document ? document.name : "Ready when you are"}
            </h2>
          </div>
          {document && (
            <button
              type="button"
              className="quiet"
              onClick={closeDocument}
            >
              <X size={16} /> Close file
            </button>
          )}
        </div>

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError("")}
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {processing && (
          <div className="processing-banner" role="status" aria-live="polite">
            <span className="processing-spinner" aria-hidden="true" />
            <span>{processing}</span>
            <small>Heavy work is running away from the interface.</small>
            <button type="button" className="quiet" onClick={closeDocument}>
              Cancel
            </button>
          </div>
        )}

        {!document ? (
          !processing ? (
            <div className="empty-state">
              <div className="empty-glyph">
                <FileJson2 />
                <FileSpreadsheet />
              </div>
              <p>Your data will appear here without leaving this page.</p>
            </div>
          ) : null
        ) : (
          <>
            <div className="file-strip" aria-label="File information">
              <div>
                <span>Format</span>
                <strong>{document.format.toUpperCase()}</strong>
              </div>
              <div>
                <span>Size</span>
                <strong>{humanSize(document.size)}</strong>
              </div>
              <div>
                <span>{document.format === "csv" ? "Rows" : "Items"}</span>
                <strong>{itemCount.toLocaleString()}</strong>
              </div>
              {document.format === "csv" && (
                <div>
                  <span>Columns</span>
                  <strong>{document.columns?.length}</strong>
                </div>
              )}
              <button
                type="button"
                className="replace"
                onClick={() => inputRef.current?.click()}
              >
                <RotateCcw size={15} /> Replace
              </button>
            </div>

            {csvIssueSummary.length > 0 && (
              <details className="quality-panel">
                <summary>
                  <span>CSV quality notice</span>
                  <strong>
                    {document.issues?.length} {document.issues?.length === 1 ? "issue" : "issues"}
                  </strong>
                </summary>
                <div className="quality-list">
                  {csvIssueSummary.map((issue) => (
                    <p key={issue.message}>
                      <span>{issue.message}</span>
                      {issue.count > 1 && <strong>×{issue.count}</strong>}
                    </p>
                  ))}
                  <small>
                    Lens kept the table usable by normalizing missing cells and
                    ignoring values beyond the detected columns.
                  </small>
                </div>
              </details>
            )}

            <details className="profile-panel">
              <summary>
                <span className="profile-title">
                  <Database size={15} aria-hidden="true" /> Data profile
                </span>
                <span className="profile-summary">
                  {csvInsights
                    ? `${csvInsights.totalEmptyCells} empty · ${csvInsights.duplicateRows} duplicate ${csvInsights.duplicateRows === 1 ? "row" : "rows"}`
                    : jsonInsights
                      ? `${jsonInsights.leafValues} values · depth ${jsonInsights.maxDepth}`
                      : ""}
                </span>
              </summary>
              {csvInsights ? (
                <div className="column-profiles">
                  {csvInsights.columns.map((column) => (
                    <div className="column-profile" key={column.name}>
                      <strong>{column.name}</strong>
                      <span className={`type-chip type-${column.type}`}>
                        {column.type}
                      </span>
                      <span>{column.emptyCount} empty</span>
                      <span>{column.uniqueCount} unique</span>
                    </div>
                  ))}
                </div>
              ) : (
                jsonInsights && (
                  <div className="json-profile">
                    <span><strong>{jsonInsights.objects}</strong> objects</span>
                    <span><strong>{jsonInsights.arrays}</strong> arrays</span>
                    <span><strong>{jsonInsights.leafValues}</strong> leaf values</span>
                    <span><strong>{jsonInsights.nullValues}</strong> null values</span>
                    <span><strong>{jsonInsights.maxDepth}</strong> levels deep</span>
                  </div>
                )
              )}
            </details>

            <div className="tool-row">
              <label className="search-box">
                <Search size={16} aria-hidden="true" />
                <span className="sr-only">Search contents</span>
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-keyshortcuts="Control+F Meta+F Escape"
                  placeholder={
                    document.format === "json"
                      ? "Search keys and values…"
                      : "Search rows…"
                  }
                />
                {query && (
                  <button
                    type="button"
                    className="clear-search"
                    onClick={clearSearch}
                    aria-label="Clear search"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                )}
              </label>
              {document.format === "csv" && (
                <label className="select-box">
                  <span className="sr-only">Filter column</span>
                  <select
                    value={filterColumn}
                    onChange={(e) => setFilterColumn(e.target.value)}
                  >
                    <option value="all">All columns</option>
                    {document.columns?.map((column) => (
                      <option key={column} value={column}>
                        {column}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={15} aria-hidden="true" />
                </label>
              )}
              {document.format === "json" && (
                <div className="segmented" role="group" aria-label="JSON view">
                  <button
                    className={preferences.jsonView === "tree" ? "active" : ""}
                    aria-pressed={preferences.jsonView === "tree"}
                    onClick={() =>
                      setPreferences((current) => ({
                        ...current,
                        jsonView: "tree",
                      }))
                    }
                  >
                    Tree
                  </button>
                  <button
                    className={preferences.jsonView === "raw" ? "active" : ""}
                    aria-pressed={preferences.jsonView === "raw"}
                    onClick={() =>
                      setPreferences((current) => ({
                        ...current,
                        jsonView: "raw",
                      }))
                    }
                  >
                    Raw
                  </button>
                </div>
              )}
              {document.format === "json" &&
                preferences.jsonView === "tree" && (
                  <button
                    type="button"
                    className={`quiet ${preferences.showJsonPaths ? "active-control" : ""}`}
                    aria-pressed={preferences.showJsonPaths}
                    onClick={() =>
                      setPreferences((current) => ({
                        ...current,
                        showJsonPaths: !current.showJsonPaths,
                      }))
                    }
                  >
                    Paths
                  </button>
                )}
              <div className="tool-actions">
                {document.format === "json" && (
                  <button type="button" className="quiet" onClick={copyJson}>
                    {copyState === "copied" ? (
                      <Check size={15} />
                    ) : (
                      <Clipboard size={15} />
                    )}{" "}
                    {copyState === "copied"
                      ? "Copied"
                      : copyState === "failed"
                        ? "Copy failed"
                        : "Copy"}
                  </button>
                )}
                <button
                  type="button"
                  className="quiet"
                  onClick={downloadOriginal}
                >
                  <Download size={15} /> Download
                </button>
                <button
                  type="button"
                  className="primary compact"
                  onClick={() => convert()}
                  disabled={conversionBusy || searchPending}
                >
                  {searchPending
                    ? "Searching…"
                    : conversionBusy
                    ? "Converting…"
                    : `Convert to ${document.format === "json" ? "CSV" : "JSON"}`}
                </button>
              </div>
            </div>

            <div className="data-pane">
              {document.format === "json" ? (
                <div className="json-views">
                  <div
                    className={`json-view ${preferences.jsonView === "tree" ? "is-active" : ""}`}
                    aria-hidden={preferences.jsonView !== "tree"}
                    inert={preferences.jsonView !== "tree"}
                  >
                    <JsonTree
                      value={document.json!}
                      search={jsonSearchPending ? "" : workerQuery}
                      showPaths={preferences.showJsonPaths}
                      exactPaths={jsonSearch.exactPaths}
                      branchPaths={jsonSearch.branchPaths}
                    />
                  </div>
                  <div
                    className={`json-view ${preferences.jsonView === "raw" ? "is-active" : ""}`}
                    aria-hidden={preferences.jsonView !== "raw"}
                    inert={preferences.jsonView !== "raw"}
                  >
                    <LargeTextView
                      content={formattedJson}
                      label="Formatted raw JSON"
                    />
                  </div>
                </div>
              ) : (
                <CsvTable
                  columns={document.columns ?? []}
                  rows={csvView.rows}
                  total={csvView.total}
                  sort={sort}
                  pageSize={CSV_PAGE_SIZE}
                  onSort={cycleSort}
                  onShowMore={showMoreCsvRows}
                />
              )}
            </div>
            {query && (
              <p className="result-note" aria-live="polite">
                {searchPending
                  ? "Searching…"
                  : document.format === "csv"
                  ? `${csvView.total} matching ${csvView.total === 1 ? "row" : "rows"}`
                  : `${jsonSearch.matches} matching ${jsonSearch.matches === 1 ? "value" : "values"}`}
              </p>
            )}
          </>
        )}
      </section>

      <footer>
        <span>Clyvora Lens</span>
        <span>Private by design · No uploads · No tracking</span>
      </footer>

      {conversion && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeConversion();
          }}
        >
          <section
            ref={dialogRef}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="conversion-title"
            aria-busy={conversionBusy}
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">Converted preview</p>
                <h2 id="conversion-title">{conversion.name}</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={closeConversion}
                aria-label="Close preview"
              >
                <X size={19} />
              </button>
            </div>
            <p className="modal-note">
              Your original file is unchanged. Download only when this preview
              looks right.
            </p>
            <div className="conversion-options" aria-label="Conversion options">
              <div className="conversion-options-title">
                <Settings2 size={15} aria-hidden="true" />
                <span>Export options</span>
                <small>Saved on this device</small>
              </div>
              {document?.format === "csv" ? (
                <label>
                  <span>Rows</span>
                  <select
                    value={preferences.exportScope}
                    disabled={conversionBusy}
                    onChange={(event) =>
                      updateConversionPreference({
                        exportScope: event.target.value as "all" | "filtered",
                      })
                    }
                  >
                    <option value="all">All rows ({document.itemCount})</option>
                    <option value="filtered">Current view ({csvView.total})</option>
                  </select>
                </label>
              ) : (
                <>
                  <label>
                    <span>Delimiter</span>
                    <select
                      value={preferences.delimiter}
                      disabled={conversionBusy}
                      onChange={(event) =>
                        updateConversionPreference({
                          delimiter: event.target.value as CsvDelimiter,
                        })
                      }
                    >
                      <option value=",">Comma</option>
                      <option value=";">Semicolon</option>
                      <option value={"\t"}>Tab</option>
                    </select>
                  </label>
                  <label>
                    <span>Line endings</span>
                    <select
                      value={preferences.newline}
                      disabled={conversionBusy}
                      onChange={(event) =>
                        updateConversionPreference({
                          newline: event.target.value as CsvLineEnding,
                        })
                      }
                    >
                      <option value={"\n"}>LF (macOS / Linux)</option>
                      <option value={"\r\n"}>CRLF (Windows)</option>
                    </select>
                  </label>
                  <label>
                    <span>Nested values</span>
                    <select
                      value={preferences.nestedMode}
                      disabled={conversionBusy}
                      onChange={(event) =>
                        updateConversionPreference({
                          nestedMode: event.target.value as NestedJsonMode,
                        })
                      }
                    >
                      <option value="stringify">Keep as JSON text</option>
                      <option value="flatten">Flatten object paths</option>
                    </select>
                  </label>
                  <label>
                    <span>Spreadsheet formulas</span>
                    <select
                      value={preferences.protectFormulas ? "protect" : "keep"}
                      disabled={conversionBusy}
                      onChange={(event) =>
                        updateConversionPreference({
                          protectFormulas: event.target.value === "protect",
                        })
                      }
                    >
                      <option value="protect">Protect risky cells</option>
                      <option value="keep">Keep unchanged</option>
                    </select>
                  </label>
                </>
              )}
            </div>
            <div className="conversion-diagnostics" aria-label="Conversion summary">
              {conversion.diagnostics.map((item) => (
                <span key={item.label}>
                  <small>{item.label}</small>
                  <strong>{item.value}</strong>
                </span>
              ))}
            </div>
            {conversion.truncated && (
              <p className="preview-limit-note">
                The on-screen preview is shortened to keep the workbench fast.
                Your download remains complete.
              </p>
            )}
            <LargeTextView
              content={conversion.preview}
              label={`Converted ${conversion.format.toUpperCase()} preview`}
            />
            {conversionBusy && (
              <div className="conversion-updating" role="status">
                Updating preview…
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="quiet"
                onClick={closeConversion}
              >
                Back to inspector
              </button>
              <button
                type="button"
                className="primary"
                disabled={conversionBusy}
                onClick={() =>
                  downloadBlob(conversion.blob, conversion.name)
                }
              >
                <Download size={16} /> Download{" "}
                {conversion.format.toUpperCase()}
              </button>
            </div>
          </section>
        </div>
      )}

      {pendingFile && (
        <div className="modal-backdrop">
          <section
            ref={dialogRef}
            className="modal compact-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="large-file-title"
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">Large file</p>
                <h2 id="large-file-title">
                  Open {humanSize(pendingFile.size)}?
                </h2>
              </div>
            </div>
            <p className="modal-note">
              This may take a moment and could make the page less responsive.
              Processing still happens only on this device.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="quiet"
                autoFocus
                onClick={() => setPendingFile(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={async () => {
                  const file = pendingFile;
                  setPendingFile(null);
                  setDocument(null);
                  resetInspectionState();
                  setProcessing("Reading large file…");
                  const readRequestId = ++readRequestRef.current;
                  try {
                    const buffer = await file.arrayBuffer();
                    if (readRequestId !== readRequestRef.current) return;
                    await loadSource(file.name, buffer, file, [buffer]);
                  } catch {
                    if (readRequestId !== readRequestRef.current) return;
                    setProcessing("");
                    setError("The file could not be read.");
                  }
                }}
              >
                Continue
              </button>
            </div>
          </section>
        </div>
      )}
      <div className="sr-only" aria-live="polite">
        {copyState === "copied"
          ? "JSON copied to clipboard"
          : copyState === "failed"
            ? "Could not copy JSON"
            : ""}
      </div>
    </main>
  );
}

export default App;
