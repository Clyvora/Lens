import { memo, useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

interface JsonTreeProps {
  value: JsonValue;
  search: string;
  showPaths?: boolean;
  exactPaths?: ReadonlySet<string>;
  branchPaths?: ReadonlySet<string>;
}

const BRANCH_PAGE_SIZE = 100;

function makeChildPath(parent: string, key: string, isArray: boolean) {
  if (isArray) return `${parent}[${key}]`;
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}

function Leaf({
  value,
}: {
  value: Exclude<JsonValue, JsonValue[] | { [key: string]: JsonValue }>;
}) {
  if (value === null) return <span className="json-null">null</span>;
  if (typeof value === "string")
    return <span className="json-string">&quot;{value}&quot;</span>;
  if (typeof value === "number")
    return <span className="json-number">{value}</span>;
  return <span className="json-boolean">{String(value)}</span>;
}

function TreeNode({
  name,
  value,
  depth,
  search,
  path,
  showPaths,
  exactPaths,
  branchPaths,
}: {
  name: string;
  value: JsonValue;
  depth: number;
  search: string;
  path: string;
  showPaths: boolean;
  exactPaths: ReadonlySet<string>;
  branchPaths: ReadonlySet<string>;
}) {
  const branch = value !== null && typeof value === "object";
  const isArray = Array.isArray(value);
  const objectKeys = useMemo(
    () => (branch && !isArray ? Object.keys(value) : []),
    [branch, isArray, value],
  );
  const entryCount = isArray ? value.length : objectKeys.length;
  const searchActive = Boolean(search);
  const ownMatch = searchActive && exactPaths.has(path);
  const descendantMatch = searchActive && branchPaths.has(path);
  const [manualOpen, setManualOpen] = useState(
    depth === 0 || (depth === 1 && entryCount <= 50),
  );
  const [visibleCount, setVisibleCount] = useState(BRANCH_PAGE_SIZE);
  const open = searchActive ? ownMatch || descendantMatch : manualOpen;

  useEffect(() => setVisibleCount(BRANCH_PAGE_SIZE), [search]);

  if (!branch) {
    return (
      <div
        role="treeitem"
        aria-selected={ownMatch}
        className={`tree-row ${ownMatch ? "is-match" : ""}`}
        style={{ "--depth": depth } as React.CSSProperties}
      >
        <span className="tree-spacer" />
        <span className="json-key">{name}</span>
        <span className="json-punctuation">: </span>
        <Leaf value={value} />
        {showPaths && <span className="json-path">{path}</span>}
      </div>
    );
  }

  let visibleKeys: string[] = [];
  let matchingCount = 0;
  if (open && isArray && (!searchActive || ownMatch)) {
    matchingCount = entryCount;
    visibleKeys = Array.from(
      { length: Math.min(entryCount, visibleCount) },
      (_, index) => String(index),
    );
  } else if (open) {
    const keys = isArray
      ? Array.from({ length: entryCount }, (_, index) => String(index))
      : objectKeys;
    const matchingKeys = searchActive && !ownMatch
      ? keys.filter((key) => {
          const nextPath = makeChildPath(path, key, isArray);
          return exactPaths.has(nextPath) || branchPaths.has(nextPath);
        })
      : keys;
    matchingCount = matchingKeys.length;
    visibleKeys = matchingKeys.slice(0, visibleCount);
  }
  return (
    <div
      role="treeitem"
      aria-expanded={open}
      aria-selected={ownMatch}
      className={`tree-branch ${descendantMatch && search ? "has-match" : ""}`}
    >
      <div
        className={`tree-row ${ownMatch ? "is-match" : ""}`}
        style={{ "--depth": depth } as React.CSSProperties}
      >
        <button
          type="button"
          className="tree-toggle"
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${name}`}
          onClick={() => setManualOpen(!open)}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        <span className="json-key">{name}</span>
        <span className="json-punctuation">: {isArray ? "[" : "{"}</span>
        <span className="tree-summary">
          {entryCount} {isArray ? "items" : "keys"}
        </span>
        {showPaths && <span className="json-path">{path}</span>}
      </div>
      {open && (
        <div role="group">
          {visibleKeys.map((key) => {
            const child = isArray
              ? (value as JsonValue[])[Number(key)]
              : (value as Record<string, JsonValue>)[key];
            const childPath = makeChildPath(path, key, isArray);
            return (
              <TreeNode
                key={key}
                name={key}
                value={child}
                depth={depth + 1}
                search={search}
                path={childPath}
                showPaths={showPaths}
                exactPaths={exactPaths}
                branchPaths={branchPaths}
              />
            );
          })}
          {visibleCount < matchingCount && (
            <div
              className="tree-row tree-more-row"
              style={{ "--depth": depth + 1 } as React.CSSProperties}
            >
              <button
                type="button"
                className="tree-more"
                onClick={() =>
                  setVisibleCount((count) => count + BRANCH_PAGE_SIZE)
                }
              >
                Show {Math.min(BRANCH_PAGE_SIZE, matchingCount - visibleCount)} more
                <span>{matchingCount - visibleCount} remaining</span>
              </button>
            </div>
          )}
          <div
            className="tree-row tree-close"
            style={{ "--depth": depth } as React.CSSProperties}
          >
            {isArray ? "]" : "}"}
          </div>
        </div>
      )}
    </div>
  );
}

export const JsonTree = memo(function JsonTree({
  value,
  search,
  showPaths = false,
  exactPaths = new Set<string>(),
  branchPaths = new Set<string>(),
}: JsonTreeProps) {
  return (
    <div className="json-tree" role="tree" aria-label="JSON structure">
      <TreeNode
        name="root"
        value={value}
        depth={0}
        search={search.trim()}
        path="$"
        showPaths={showPaths}
        exactPaths={exactPaths}
        branchPaths={branchPaths}
      />
    </div>
  );
});
