import { memo } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

interface SortSpec {
  column: string;
  direction: "asc" | "desc";
}

interface CsvTableProps {
  columns: string[];
  rows: Array<Record<string, string>>;
  total: number;
  sort: SortSpec | null;
  pageSize: number;
  onSort: (column: string) => void;
  onShowMore: () => void;
}

export const CsvTable = memo(function CsvTable({
  columns,
  rows,
  total,
  sort,
  pageSize,
  onSort,
  onShowMore,
}: CsvTableProps) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                aria-sort={
                  sort?.column === column
                    ? sort.direction === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <button type="button" onClick={() => onSort(column)}>
                  {column}
                  {sort?.column === column ? (
                    sort.direction === "asc" ? (
                      <ArrowUp size={13} />
                    ) : (
                      <ArrowDown size={13} />
                    )
                  ) : (
                    <span className="sort-placeholder" />
                  )}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {total ? (
            <>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {columns.map((column) => (
                    <td key={column}>
                      {row[column] === "" || row[column] == null ? (
                        <span className="empty-cell" aria-label="Empty cell">
                          —
                        </span>
                      ) : (
                        row[column]
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length < total && (
                <tr className="table-more-row">
                  <td colSpan={columns.length || 1}>
                    <button
                      type="button"
                      className="table-more"
                      onClick={onShowMore}
                    >
                      Show next {Math.min(pageSize, total - rows.length)} rows
                      <span>{total - rows.length} remaining</span>
                    </button>
                  </td>
                </tr>
              )}
            </>
          ) : (
            <tr>
              <td className="no-results" colSpan={columns.length || 1}>
                No rows match this search.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
});
