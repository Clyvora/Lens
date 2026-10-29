import {
  AppHeader,
  IntakeSurface,
  DocumentToolbar,
  ProfilePanel,
  PasteDialog,
  ConversionDialog,
} from "./components/Workbench";
import { MorphText } from "./MorphText";
import { ChoiceGroup } from "./ChoiceGroup";
import { FileSidebar } from "./components/FileSidebar";
import { SelectionDetails } from "./components/SelectionDetails";
import type { DataSelection } from "./components/SelectionDetails";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import {
  Check,
  ChevronDown,
  Clipboard,
  ClipboardPaste,
  Download,
  ExternalLink,
  FileJson2,
  FileSpreadsheet,
  FolderOpen,
  RotateCcw,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { CsvTable } from "./components/CsvTable";
import { JsonTree } from "./components/JsonTree";
import { DataWorkerClient } from "./lib/dataWorkerClient";
import type {
  CsvColumnInsight,
  CsvDelimiter,
  CsvEmptyMode,
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
  jsonTableSources?: Array<{ id: string; label: string; rows: number }>;
}

const JSON_EXAMPLE = `[
  { "name": "Ada", "city": "London", "active": true, "skills": ["Research", "Design"] },
  { "name": "Grace", "city": "New York", "active": true, "skills": ["Engineering"] },
  { "name": "Linus", "city": "Helsinki", "active": false, "skills": ["Engineering", "Writing"] },
  { "name": "Margaret", "city": "Chicago", "active": true, "skills": ["Research"] }
]`;

const CSV_EXAMPLE = `name,category,status,notes
Atlas,Design,Active,"Grid, orbit, and type"
Beacon,Research,Paused,"Said ""keep it local"""
Morrow,Engineering,Active,
Lumen,Operations,Review,"Ready for inspection"`;

const LARGE_FILE_WARNING_BYTES = 10 * 1024 * 1024;
const DESKTOP_FILE_LIMIT_BYTES = 25 * 1024 * 1024;
const CONSTRAINED_FILE_LIMIT_BYTES = 10 * 1024 * 1024;
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
  inferCsvTypes: boolean;
  csvEmptyMode: CsvEmptyMode;
}

const DEFAULT_PREFERENCES: Preferences = {
  jsonView: "tree",
  showJsonPaths: false,
  delimiter: ",",
  newline: "\n",
  nestedMode: "stringify",
  protectFormulas: true,
  exportScope: "all",
  inferCsvTypes: true,
  csvEmptyMode: "empty",
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

function fileLimitBytes() {
  const mobile =
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const memory = (navigator as Navigator & { deviceMemory?: number })
    .deviceMemory;
  return mobile || (typeof memory === "number" && memory <= 4)
    ? CONSTRAINED_FILE_LIMIT_BYTES
    : DESKTOP_FILE_LIMIT_BYTES;
}

function fileLimitMessage(limit: number) {
  return `This file is larger than Lens's ${humanSize(limit)} safety limit for this device.`;
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
  const dragDepthRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const readRequestRef = useRef(0);
  const loadRequestRef = useRef(0);
  const csvRequestRef = useRef(0);
  const jsonSearchRequestRef = useRef(0);
  const conversionRequestRef = useRef(0);
  const pasteAttemptRef = useRef(0);
  const pasteWorkerRef = useRef<DataWorkerClient | null>(null);
  const [document, setDocument] = useState<DocumentState | null>(null);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState("");
  const [dragging, setDragging] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [pasteFormat, setPasteFormat] = useState<"auto" | Format>("auto");
  const [pasteError, setPasteError] = useState("");
  const [pasteIssue, setPasteIssue] = useState<ParseIssue | undefined>();
  const [pasteBusy, setPasteBusy] = useState(false);
  const [conversionError, setConversionError] = useState("");
  const [exportTab, setExportTab] = useState<"settings" | "preview">(
    "settings",
  );
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences);
  const [query, setQuery] = useState("");
  const [workerQuery, setWorkerQuery] = useState("");
  const [filterColumn, setFilterColumn] = useState<string | null>(null);
  const [visibleCsvRows, setVisibleCsvRows] = useState(CSV_PAGE_SIZE);
  const [csvView, setCsvView] = useState<CsvQueryPayload>({
    rows: [],
    total: 0,
  });
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
  const [jsonTableSource, setJsonTableSource] = useState("");
  const [selection, setSelection] = useState<DataSelection | null>(null);

  const clearSearch = useCallback(() => {
    setQuery("");
    setWorkerQuery("");
  }, []);

  const closePaste = useCallback(() => {
    pasteAttemptRef.current += 1;
    pasteWorkerRef.current?.dispose();
    pasteWorkerRef.current = null;
    setPasteBusy(false);
    setPasteOpen(false);
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
  const anyModalOpen = conversionOpen || pendingFileOpen || pasteOpen;

  useEffect(() => () => pasteWorkerRef.current?.dispose(), []);

  useEffect(() => {
    const onShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        if (!anyModalOpen) inputRef.current?.click();
        return;
      }
      if (
        document &&
        !anyModalOpen &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (event.key === "Escape" && query && !anyModalOpen) {
        clearSearch();
        searchInputRef.current?.focus();
      }
    };
    globalThis.document.addEventListener("keydown", onShortcut);
    return () => globalThis.document.removeEventListener("keydown", onShortcut);
  }, [anyModalOpen, clearSearch, document, query]);

  useEffect(() => {
    if (!anyModalOpen) return;
    previousFocusRef.current = globalThis.document
      .activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter(
        (element) =>
          !element.hasAttribute("disabled") &&
          element.getClientRects().length > 0,
      );
    (
      dialogRef.current?.querySelector<HTMLElement>(".paste-editor") ??
      focusable()[0]
    )?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeConversion();
        setPendingFile(null);
        closePaste();
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
  }, [anyModalOpen, closeConversion, closePaste]);

  const resetInspectionState = () => {
    setSelection(null);
    clearSearch();
    setFilterColumn(null);
    setSort(null);
    setConversion(null);
    setCopyState("idle");
    setCsvView({ rows: [], total: 0 });
    setJsonSearch({
      exactPaths: new Set(),
      branchPaths: new Set(),
      matches: 0,
    });
    setJsonTableSource("");
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
      const payload = await dataWorker.request<ParsedDocumentPayload>(
        {
          type: "parse",
          filename: name,
          content,
        },
        transfer,
      );
      if (requestId !== loadRequestRef.current) return;
      setDocument({ name, size: sourceBlob.size, sourceBlob, ...payload });
      setJsonTableSource(payload.jsonTableSources?.[0]?.id ?? "");
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
    const limit = fileLimitBytes();
    if (blob.size > limit) {
      setError(fileLimitMessage(limit));
      return Promise.resolve();
    }
    return loadSource(name, content, blob);
  };

  const readFile = async (file: File) => {
    if (!/\.(json|csv)$/i.test(file.name)) {
      setError("Unsupported file type. Choose a .json or .csv file.");
      return;
    }
    const limit = fileLimitBytes();
    if (file.size > limit) {
      setPendingFile(null);
      setError(fileLimitMessage(limit));
      return;
    }
    if (file.size > LARGE_FILE_WARNING_BYTES) {
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
    dragDepthRef.current = 0;
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) readFile(file);
  };

  const inspectPastedData = async () => {
    const trimmed = pasteValue.trim();
    if (!trimmed || pasteBusy) return;
    setPasteError("");
    setPasteIssue(undefined);
    if (new Blob([pasteValue]).size > fileLimitBytes()) {
      setPasteError(fileLimitMessage(fileLimitBytes()));
      return;
    }
    setPasteBusy(true);
    const attempt = ++pasteAttemptRef.current;
    const pasteWorker = new DataWorkerClient();
    pasteWorkerRef.current = pasteWorker;
    try {
      const payload = await pasteWorker.request<ParsedDocumentPayload>({
        type: "parse",
        filename: "pasted-data",
        content: pasteValue,
        format: pasteFormat,
      });
      if (attempt !== pasteAttemptRef.current) return;
      pasteWorkerRef.current = null;
      dataWorker.dispose();
      dataWorker = pasteWorker;
      resetInspectionState();
      setDocument({
        name: `pasted-data.${payload.format}`,
        size: new Blob([pasteValue]).size,
        sourceBlob: new Blob([pasteValue]),
        ...payload,
      });
      setJsonTableSource(payload.jsonTableSources?.[0]?.id ?? "");
      setError("");
      closePaste();
    } catch (cause) {
      pasteWorker.dispose();
      if (attempt !== pasteAttemptRef.current) return;
      setPasteError(
        cause instanceof Error ? cause.message : "Could not inspect this data.",
      );
      setPasteIssue((cause as { issue?: ParseIssue }).issue);
    } finally {
      if (attempt === pasteAttemptRef.current) setPasteBusy(false);
    }
  };

  useEffect(
    () => setVisibleCsvRows(CSV_PAGE_SIZE),
    [document, workerQuery, filterColumn, sort],
  );

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
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not filter this CSV.",
          );
      })
      .finally(() => {
        if (requestId === csvRequestRef.current) setCsvQueryPending(false);
      });
  }, [document, filterColumn, sort, visibleCsvRows, workerQuery]);

  useEffect(() => {
    if (document?.format !== "json") return;
    const requestId = ++jsonSearchRequestRef.current;
    if (!workerQuery.trim()) {
      setJsonSearch({
        exactPaths: new Set(),
        branchPaths: new Set(),
        matches: 0,
      });
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
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not search this JSON.",
          );
      })
      .finally(() => {
        if (requestId === jsonSearchRequestRef.current)
          setJsonSearchPending(false);
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
  const jsonTableSources = document?.jsonTableSources ?? [];
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

  const convert = async (
    nextPreferences: Preferences = preferences,
    nextJsonTableSource = jsonTableSource,
  ) => {
    if (!document) return;
    const requestId = ++conversionRequestRef.current;
    setConversionBusy(true);
    setConversionError("");
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
        jsonTableSource: nextJsonTableSource,
        inferCsvTypes: nextPreferences.inferCsvTypes,
        csvEmptyMode: nextPreferences.csvEmptyMode,
      });
      if (requestId !== conversionRequestRef.current) return;
      setConversion({
        ...result,
        name: `${baseName(document.name)}.${result.format}`,
      });
    } catch (cause) {
      if (requestId === conversionRequestRef.current) {
        const message =
          cause instanceof Error
            ? cause.message
            : "Could not convert this file.";
        setConversionError(message);
        if (!conversion) setError(message);
      }
    } finally {
      if (requestId === conversionRequestRef.current) setConversionBusy(false);
    }
  };

  const updateConversionPreference = (patch: Partial<Preferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    void convert(next);
  };

  const updateJsonSource = (source: string) => {
    setJsonTableSource(source);
    void convert(preferences, source);
  };

  return (
    <main className={document ? "document-open" : ""}>
      <div className="app-surface" inert={anyModalOpen}>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept=".json,.csv,application/json,text/csv"
          onChange={onFile}
          tabIndex={-1}
        />
        <AppHeader className="topbar">
          <a
            href={document ? "#workspace" : "#top"}
            className="brand"
            aria-label="Clyvora Lens home"
          >
            <img
              src="/app-icon.webp"
              alt=""
              width="32"
              height="32"
              decoding="async"
            />
            <span>Clyvora Lens</span>
          </a>
          <nav className="site-nav" aria-label="Clyvora sites">
            <a href="https://www.convert.clyvora.tech">Clyvora Convert</a>
            <a href="https://www.clyvora.tech">Clyvora</a>
            <span className="header-local">Files stay on this device</span>
          </nav>
        </AppHeader>
        <FileSidebar
          name={document?.name}
          format={document?.format}
          size={document ? humanSize(document.size) : undefined}
          onOpen={() => inputRef.current?.click()}
          onPaste={() => {
            setPasteError("");
            setPasteIssue(undefined);
            setPasteOpen(true);
          }}
          onExample={(format) => {
            void loadContent(
              format === "json" ? "people.json" : "projects.csv",
              format === "json" ? JSON_EXAMPLE : CSV_EXAMPLE,
            );
          }}
        />

        {!document && (
          <section id="top" className="intro" aria-labelledby="page-title">
            <div className="entry-heading">
              <p className="eyebrow">YOUR FILE WORKSPACE</p>
              <h1 id="page-title">A closer look at your data.</h1>
              <p className="lede">
                Open a JSON or CSV file to explore what’s inside. Find a value,
                understand its structure, or save it in another format.
              </p>
              <ol className="getting-started">
                <li>
                  <span>1</span>
                  <div>
                    <strong>Open your file</strong>
                    <p>Choose a file, drop it here, or paste your data.</p>
                  </div>
                </li>
                <li>
                  <span>2</span>
                  <div>
                    <strong>Take a look around</strong>
                    <p>Expand fields, search values, and sort rows.</p>
                  </div>
                </li>
                <li>
                  <span>3</span>
                  <div>
                    <strong>Save a copy</strong>
                    <p>Export as JSON or CSV. Your original stays unchanged.</p>
                  </div>
                </li>
              </ol>
            </div>
            <IntakeSurface
              className={`drop-zone ${dragging ? "is-dragging" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                dragDepthRef.current += 1;
                setDragging(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDragLeave={() => {
                dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                if (dragDepthRef.current === 0) setDragging(false);
              }}
              onDrop={onDrop}
              aria-label="Drop a JSON or CSV file here, or use the Choose file button"
            >
              <div className="drop-icon">
                <FolderOpen size={26} aria-hidden="true" />
              </div>
              <div>
                <strong>Drop a file to inspect</strong>
                <span>JSON or CSV · processed locally</span>
              </div>
              <div className="drop-actions">
                <button
                  type="button"
                  className="primary"
                  aria-keyshortcuts="Control+O Meta+O"
                  onClick={(event) => {
                    event.stopPropagation();
                    inputRef.current?.click();
                  }}
                >
                  Open file
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    setPasteError("");
                    setPasteIssue(undefined);
                    setPasteOpen(true);
                  }}
                >
                  <ClipboardPaste size={15} aria-hidden="true" /> Paste data
                </button>
              </div>
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
              <p className="shortcut-hint">
                <kbd>Ctrl</kbd> <span>+</span> <kbd>O</kbd> opens a file
              </p>
            </IntakeSurface>
          </section>
        )}

        {(document || error || processing) && (
          <section
            id="workspace"
            className={`workspace ${document ? "has-document" : ""}`}
            aria-labelledby="workspace-title"
          >
            <div className="workspace-head">
              <div>
                <p className="eyebrow">
                  Current file <span className="breadcrumb-separator">/</span>{" "}
                  root
                </p>
                <h2 id="workspace-title">
                  {document ? document.name : "Ready when you are"}
                </h2>
              </div>
              {document && (
                <div className="document-actions">
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => {
                      setPasteError("");
                      setPasteOpen(true);
                    }}
                  >
                    <ClipboardPaste size={16} /> Paste
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => inputRef.current?.click()}
                  >
                    <FolderOpen size={16} /> Open
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    onClick={closeDocument}
                  >
                    <X size={16} /> Close
                  </button>
                </div>
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
              <div
                className="processing-banner"
                role="status"
                aria-live="polite"
              >
                <span className="processing-spinner" aria-hidden="true" />
                <MorphText>{processing}</MorphText>
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
                        {document.issues?.length}{" "}
                        {document.issues?.length === 1 ? "issue" : "issues"}
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
                        Lens kept the table usable by normalizing missing cells
                        and ignoring values beyond the detected columns.
                      </small>
                    </div>
                  </details>
                )}

                <ProfilePanel className="profile-panel">
                  <summary>
                    <span className="profile-title">About this selection</span>
                  </summary>
                  {document.format === "json" && (
                    <SelectionDetails
                      key={selection?.path ?? "$"}
                      selection={
                        selection ?? { path: "$", value: document.json! }
                      }
                    />
                  )}
                  {document.format === "csv" && (
                    <div className="selection-details">
                      <p className="selection-description">
                        A table of {document.itemCount} rows and{" "}
                        {document.columns?.length} columns. Click a column
                        heading to sort. Search to find a row.
                      </p>
                      <h3>Columns in this file</h3>
                      <div className="column-profiles">
                        {csvInsights?.columns.map((column) => (
                          <div className="column-profile" key={column.name}>
                            <strong>{column.name}</strong>
                            <span className="type-chip">{column.type}</span>
                            <span>
                              {column.emptyCount} empty · {column.uniqueCount}{" "}
                              unique
                            </span>
                          </div>
                        ))}
                      </div>
                      <p className="selection-tip">
                        CSV values are stored as text. You can choose how to
                        handle types when exporting JSON.
                      </p>
                    </div>
                  )}
                  <details className="file-profile">
                    <summary>File overview</summary>
                    <div className="json-profile">
                      {jsonInsights ? (
                        <>
                          <span>
                            <strong>{jsonInsights.objects}</strong> objects
                          </span>
                          <span>
                            <strong>{jsonInsights.arrays}</strong> arrays
                          </span>
                          <span>
                            <strong>{jsonInsights.leafValues}</strong> values
                          </span>
                        </>
                      ) : (
                        <>
                          <span>
                            {csvInsights?.totalEmptyCells} empty cells
                          </span>
                          <span>
                            {csvInsights?.duplicateRows} duplicate rows
                          </span>
                        </>
                      )}
                    </div>
                  </details>
                </ProfilePanel>

                {document.format === "json" &&
                  jsonTableSources.length === 0 && (
                    <div className="conversion-hint" role="note">
                      This JSON can be inspected, but CSV conversion needs at
                      least one array containing objects. No convertible table
                      was found.
                    </div>
                  )}

                <DocumentToolbar>
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
                          value={JSON.stringify(filterColumn)}
                          onChange={(e) =>
                            setFilterColumn(JSON.parse(e.target.value))
                          }
                        >
                          <option value="null">All columns</option>
                          {document.columns?.map((column) => (
                            <option key={column} value={JSON.stringify(column)}>
                              {column}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={15} aria-hidden="true" />
                      </label>
                    )}
                    {document.format === "json" && (
                      <div
                        className="segmented"
                        role="group"
                        aria-label="JSON view"
                      >
                        <button
                          className={
                            preferences.jsonView === "tree" ? "active" : ""
                          }
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
                          className={
                            preferences.jsonView === "raw" ? "active" : ""
                          }
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
                        <button
                          type="button"
                          className="quiet"
                          onClick={copyJson}
                        >
                          {copyState === "copied" ? (
                            <Check size={15} />
                          ) : (
                            <Clipboard size={15} />
                          )}{" "}
                          <MorphText>
                            {copyState === "copied"
                              ? "Copied"
                              : copyState === "failed"
                                ? "Copy failed"
                                : "Copy"}
                          </MorphText>
                        </button>
                      )}
                      <button
                        type="button"
                        className="quiet"
                        onClick={downloadOriginal}
                      >
                        <Download size={15} />{" "}
                        {document.format === "json"
                          ? "Formatted JSON"
                          : "Original CSV"}
                      </button>
                    </div>
                  </div>
                </DocumentToolbar>
                {document.format === "csv" && (
                  <p className="scroll-hint">
                    {csvView.total.toLocaleString()} rows · Click a heading to
                    sort · Scroll sideways for more columns
                  </p>
                )}
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
                          onSelect={(path, value) =>
                            setSelection({ path, value })
                          }
                          selectedPath={selection?.path ?? "$"}
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
            {document && (
              <div className="export-bar">
                <span className="export-reassurance">
                  ✓ Processed on this device
                  <small>Your original file stays unchanged.</small>
                </span>{" "}
                <button
                  type="button"
                  className="primary compact"
                  onClick={() => convert()}
                  disabled={
                    conversionBusy ||
                    searchPending ||
                    (document.format === "json" && !jsonTableSource)
                  }
                  title={
                    document.format === "json" && !jsonTableSource
                      ? "No array of objects is available to convert"
                      : undefined
                  }
                >
                  {searchPending
                    ? "Searching…"
                    : conversionBusy
                      ? "Converting…"
                      : `Convert to ${document.format === "json" ? "CSV" : "JSON"}`}
                </button>{" "}
              </div>
            )}
          </section>
        )}

        <footer>
          <div className="footer-links">
            <a href="https://www.clyvora.tech/about/">About Clyvora</a>
            <a href="https://www.convert.clyvora.tech">Clyvora Convert</a>
            <a
              href="https://github.com/Clyvora/Lens"
              target="_blank"
              rel="noreferrer"
              aria-label="View Clyvora Lens source code on GitHub"
            >
              <ExternalLink size={14} aria-hidden="true" /> GitHub
            </a>
          </div>
          <span>Files stay on this device.</span>
        </footer>
      </div>
      {conversion && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeConversion();
          }}
        >
          <ConversionDialog
            ref={dialogRef}
            className={`modal export-modal tab-${exportTab}`}
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
              Preview your export. Your original file stays unchanged.
            </p>
            <div
              className="export-tabs"
              role="tablist"
              aria-label="Export view"
            >
              {(["settings", "preview"] as const).map((tab) => (
                <button
                  key={tab}
                  role="tab"
                  id={`export-tab-${tab}`}
                  aria-controls={`export-${tab}`}
                  aria-selected={exportTab === tab}
                  tabIndex={exportTab === tab ? 0 : -1}
                  onKeyDown={(event) => {
                    if (
                      event.key === "ArrowLeft" ||
                      event.key === "ArrowRight"
                    ) {
                      const next = tab === "settings" ? "preview" : "settings";
                      setExportTab(next);
                      globalThis.document
                        .getElementById(`export-tab-${next}`)
                        ?.focus();
                    }
                  }}
                  onClick={() => setExportTab(tab)}
                >
                  {tab === "settings" ? "Settings" : "Preview"}
                </button>
              ))}
            </div>
            {conversionError && (
              <div className="error-banner" role="alert">
                {conversionError} Preview is outdated. Change settings to try
                again.
              </div>
            )}
            <div className="export-body">
              <div
                id="export-settings"
                className="conversion-options"
                aria-label="Conversion options"
              >
                <div className="conversion-options-title">
                  <Settings2 size={15} aria-hidden="true" />
                  <span>Export settings</span>
                  <small>Saved on this device</small>
                </div>
                {document?.format === "csv" ? (
                  <>
                    <ChoiceGroup
                      label="Rows"
                      value={preferences.exportScope}
                      disabled={conversionBusy}
                      choices={[
                        {
                          value: "all",
                          label: "All rows",
                          description: String(document.itemCount),
                        },
                        {
                          value: "filtered",
                          label: "Current view",
                          description: String(csvView.total),
                        },
                      ]}
                      onChange={(value) =>
                        updateConversionPreference({
                          exportScope: value as "all" | "filtered",
                        })
                      }
                    />
                    <label>
                      <span>Value types</span>
                      <select
                        value={preferences.inferCsvTypes ? "infer" : "text"}
                        disabled={conversionBusy}
                        onChange={(event) =>
                          updateConversionPreference({
                            inferCsvTypes: event.target.value === "infer",
                          })
                        }
                      >
                        <option value="infer">
                          Infer numbers and booleans
                        </option>
                        <option value="text">Keep every value as text</option>
                      </select>
                    </label>
                    <label>
                      <span>Empty cells</span>
                      <select
                        value={preferences.csvEmptyMode}
                        disabled={conversionBusy}
                        onChange={(event) =>
                          updateConversionPreference({
                            csvEmptyMode: event.target.value as CsvEmptyMode,
                          })
                        }
                      >
                        <option value="empty">Empty text</option>
                        <option value="null">null</option>
                        <option value="omit">Omit property</option>
                      </select>
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      <span>Table source</span>
                      <select
                        value={jsonTableSource}
                        disabled={conversionBusy}
                        onChange={(event) =>
                          updateJsonSource(event.target.value)
                        }
                      >
                        {jsonTableSources.map((source) => (
                          <option key={source.id} value={source.id}>
                            {source.label} ({source.rows} rows)
                          </option>
                        ))}
                      </select>
                    </label>
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
                        <option value="expand">Expand arrays into rows</option>
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
              <div id="export-preview" className="export-preview">
                {document?.format === "json" && (
                  <p className="option-help">
                    {preferences.nestedMode === "expand"
                      ? "Each array item becomes a row. Sibling arrays create combinations of their values. Expansion limits apply."
                      : preferences.nestedMode === "flatten"
                        ? "Nested keys become dotted column paths. Arrays remain JSON text."
                        : "Objects and arrays stay together as JSON text in a cell."}
                  </p>
                )}
                <div
                  className="conversion-diagnostics"
                  aria-label="Conversion summary"
                >
                  {conversion.diagnostics.map((item) => (
                    <span key={item.label}>
                      <small>{item.label}</small>
                      <strong>{item.value}</strong>
                    </span>
                  ))}
                </div>
                {conversion.truncated && (
                  <p className="preview-limit-note">
                    The on-screen preview is shortened to keep the workbench
                    fast. Your download remains complete.
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
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="quiet" onClick={closeConversion}>
                Back to inspector
              </button>
              <button
                type="button"
                className="primary"
                disabled={conversionBusy || Boolean(conversionError)}
                onClick={() => downloadBlob(conversion.blob, conversion.name)}
              >
                <Download size={16} />
                <MorphText>
                  {conversionBusy
                    ? "Updating preview…"
                    : `Download ${conversion.format.toUpperCase()}`}
                </MorphText>
              </button>
            </div>
          </ConversionDialog>
        </div>
      )}

      {pasteOpen && (
        <div className="modal-backdrop">
          <PasteDialog
            ref={dialogRef}
            className="modal paste-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="paste-title"
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">Local input</p>
                <h2 id="paste-title">Paste JSON or CSV</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={closePaste}
                aria-label="Close paste editor"
              >
                <X size={19} />
              </button>
            </div>
            <p className="modal-note">
              Paste, review, and edit the data below. Nothing is inspected until
              you choose Inspect data, and nothing leaves this browser.
            </p>
            <div className="paste-format">
              <label>
                Input format
                <select
                  aria-label="Input format"
                  value={pasteFormat}
                  onChange={(event) =>
                    setPasteFormat(event.target.value as "auto" | Format)
                  }
                >
                  <option value="auto">Auto detect</option>
                  <option value="json">JSON</option>
                  <option value="csv">CSV</option>
                </select>
              </label>
              <span>JSON and CSV, processed locally.</span>
            </div>
            {pasteError && (
              <div className="error-banner" role="alert">
                {pasteError}
              </div>
            )}
            {pasteIssue?.line && (
              <pre className="error-context">
                Line {pasteIssue.line}
                {pasteIssue.column ? `, column ${pasteIssue.column}` : ""}
                {": "}
                {pasteValue.split(/\r?\n/)[pasteIssue.line - 1]}
              </pre>
            )}
            <label className="paste-editor-label">
              <span className="sr-only">JSON or CSV data</span>
              <textarea
                className="paste-editor"
                value={pasteValue}
                onChange={(event) => setPasteValue(event.target.value)}
                placeholder={
                  'Paste JSON or CSV here…\n\nExample: [{"name":"Ada"}]'
                }
                spellCheck={false}
                autoFocus
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="quiet"
                onClick={closePaste}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                disabled={!pasteValue.trim() || pasteBusy}
                onClick={() => void inspectPastedData()}
              >
                <MorphText>
                  {pasteValue.trim()
                    ? "Inspect data"
                    : "Paste data to continue"}
                </MorphText>
              </button>
            </div>
          </PasteDialog>
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
