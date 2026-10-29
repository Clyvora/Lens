import {
  ClipboardPaste,
  FileJson2,
  FileSpreadsheet,
  FolderOpen,
  ShieldCheck,
} from "lucide-react";

interface FileSidebarProps {
  name?: string;
  format?: string;
  size?: string;
  onOpen: () => void;
  onPaste: () => void;
  onExample: (format: "json" | "csv") => void;
}

export function FileSidebar({
  name,
  format,
  size,
  onOpen,
  onPaste,
  onExample,
}: FileSidebarProps) {
  return (
    <aside className="file-sidebar" aria-label="File tools">
      <div className="sidebar-actions">
        <button className="primary" onClick={onOpen}>
          <FolderOpen size={18} /> Open file
          <span className="key-hint">Ctrl O</span>
        </button>
        <button className="quiet" onClick={onPaste}>
          <ClipboardPaste size={18} /> Paste data
        </button>
      </div>
      <section className="sidebar-section">
        <h2>Current file</h2>
        {name ? (
          <>
            <div className="current-file">
              {format === "json" ? (
                <FileJson2 size={18} />
              ) : (
                <FileSpreadsheet size={18} />
              )}
              <strong title={name}>{name}</strong>
            </div>
            <p className="file-caption">
              {format?.toUpperCase()} · {size}
            </p>
          </>
        ) : (
          <p className="sidebar-empty">
            No file open yet.
            <br />
            Choose a file or paste your data.
          </p>
        )}
      </section>
      <section className="sidebar-section">
        <h2>Try an example</h2>
        <button className="example-file" onClick={() => onExample("json")}>
          <FileJson2 size={17} />
          <span>
            People.json<small>Explore nested data</small>
          </span>
        </button>
        <button className="example-file" onClick={() => onExample("csv")}>
          <FileSpreadsheet size={17} />
          <span>
            Projects.csv<small>Search and sort a table</small>
          </span>
        </button>
      </section>
      <div className="sidebar-privacy">
        <ShieldCheck size={20} />
        <p>
          On your device<small>File contents are never uploaded.</small>
        </p>
      </div>
    </aside>
  );
}
