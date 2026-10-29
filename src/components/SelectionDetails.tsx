import { useState } from "react";
import { Copy, Check } from "lucide-react";
import type { JsonValue } from "../lib";

export interface DataSelection {
  path: string;
  value: JsonValue;
}

export function SelectionDetails({ selection }: { selection: DataSelection }) {
  const [copied, setCopied] = useState("");
  const { value, path } = selection;
  const type =
    value === null
      ? "Null"
      : Array.isArray(value)
        ? "Array"
        : typeof value === "object"
          ? "Object"
          : typeof value === "string"
            ? "Text"
            : typeof value === "number"
              ? "Number"
              : "Boolean";
  const count = Array.isArray(value)
    ? value.length
    : value && typeof value === "object"
      ? Object.keys(value).length
      : null;
  const description = Array.isArray(value)
    ? `A list of ${count} ${count === 1 ? "item" : "items"}. Expand an item to see what it contains.`
    : value && typeof value === "object"
      ? `An object with ${count} ${count === 1 ? "field" : "fields"}. Each field has a name and a value.`
      : type === "Text"
        ? "A text value. Quotes mark the start and end of the text."
        : type === "Boolean"
          ? "A true or false value, often used for a yes or no answer."
          : type === "Number"
            ? "A numeric value that can be used in calculations."
            : "An empty value. Null means no value was provided.";
  const preview = Array.isArray(value)
    ? (value[0] ?? [])
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).slice(0, 5))
      : value;
  async function copy(kind: string) {
    try {
      await navigator.clipboard.writeText(
        kind === "Path" ? path : JSON.stringify(value, null, 2),
      );
      setCopied(kind);
    } catch {
      setCopied("Copy failed");
    }
  }
  return (
    <div className="selection-details">
      <p className="selection-description">{description}</p>
      <dl>
        <div>
          <dt>Type</dt>
          <dd>{type}</dd>
        </div>
        {count !== null && (
          <div>
            <dt>{type === "Array" ? "Items" : "Fields"}</dt>
            <dd>{count}</dd>
          </div>
        )}
        <div>
          <dt>Path</dt>
          <dd className="selection-path">{path}</dd>
        </div>
      </dl>
      <div className="selection-copy">
        <button className="quiet" onClick={() => void copy("Value")}>
          {copied === "Value" ? <Check size={14} /> : <Copy size={14} />} Copy
          value
        </button>
        <button className="quiet" onClick={() => void copy("Path")}>
          {copied === "Path" ? <Check size={14} /> : <Copy size={14} />} Copy
          path
        </button>
      </div>
      <span className="sr-only" aria-live="polite">
        {copied ? `${copied}${copied === "Copy failed" ? "" : " copied"}` : ""}
      </span>
      <h3>{Array.isArray(value) ? "Preview · first item" : "Preview"}</h3>
      <pre className="selection-preview">
        {JSON.stringify(preview, null, 2)?.slice(0, 1600)}
      </pre>
      <p className="selection-tip">
        Select a field in the tree to take a closer look.
      </p>
    </div>
  );
}
