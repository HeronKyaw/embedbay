import * as React from "react";
import { flexRender } from "@tanstack/react-table";
import {
  getCoreRowModel,
  type LegacyColumnDef,
  useLegacyTable,
} from "@tanstack/react-table/legacy";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { VectorRecord } from "@/types/explorer";

export function RecordTable({
  records,
  loading,
  selectedId,
  showScore = false,
  totalCount,
  pageInfo,
  canPrev,
  canNext,
  onPrevPage,
  onNextPage,
  onSelectRecord,
  onFindSimilar,
  onDeleteRecords,
}: {
  records: VectorRecord[];
  loading: boolean;
  selectedId: string | null;
  showScore?: boolean;
  totalCount?: number | null;
  pageInfo?: string;
  canPrev?: boolean;
  canNext?: boolean;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  onSelectRecord: (record: VectorRecord) => void;
  onFindSimilar: (record: VectorRecord) => void;
  onDeleteRecords: (ids: string[]) => void;
}) {
  const [checkedIds, setCheckedIds] = React.useState<Record<string, boolean>>(
    {},
  );
  const parentRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setCheckedIds({});
  }, [records]);

  const selectedKeys = React.useMemo(
    () => Object.keys(checkedIds).filter((k) => checkedIds[k]),
    [checkedIds],
  );

  const toggleAll = (checked: boolean) => {
    if (!checked) {
      setCheckedIds({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const r of records) next[r.id] = true;
    setCheckedIds(next);
  };

  const columns = React.useMemo<LegacyColumnDef<VectorRecord>[]>(() => {
    const base: LegacyColumnDef<VectorRecord>[] = [
      {
        id: "select",
        header: () => (
          <input
            type="checkbox"
            aria-label="Select all records"
            checked={
              records.length > 0 && selectedKeys.length === records.length
            }
            onChange={(e) => toggleAll(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--accent-primary)]"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Select record ${row.original.id}`}
            checked={Boolean(checkedIds[row.original.id])}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              setCheckedIds((prev) => ({
                ...prev,
                [row.original.id]: e.target.checked,
              }))
            }
            className="h-3.5 w-3.5 accent-[var(--accent-primary)]"
          />
        ),
        size: 36,
      },
      {
        accessorKey: "id",
        header: "ID",
        cell: ({ row }) => (
          <span className="block truncate font-mono text-[11px] font-medium text-[var(--accent-secondary)]">
            {row.original.id}
          </span>
        ),
        size: 150,
      },
    ];

    if (showScore) {
      base.push({
        accessorKey: "score",
        header: "Score",
        cell: ({ row }) => {
          const score = row.original.score;
          if (score == null) return <span className="text-[var(--text-muted)]">—</span>;
          const pct = Math.max(0, Math.min(100, score * 100));
          return (
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-12 overflow-hidden rounded-full bg-[var(--bg-canvas)]">
                <div
                  className="h-full bg-[var(--accent-secondary)]"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="font-mono text-[11px] text-[var(--text-primary)]">
                {score.toFixed(4)}
              </span>
            </div>
          );
        },
        size: 130,
      });
    }

    base.push(
      {
        id: "payload",
        header: "Metadata / Document",
        cell: ({ row }) => {
          const doc = row.original.document;
          const payloadStr = JSON.stringify(row.original.payload ?? {});
          return (
            <div className="min-w-0">
              {doc && (
                <div className="truncate text-xs text-[var(--text-primary)]">
                  {doc}
                </div>
              )}
              <div className="truncate font-mono text-[10px] text-[var(--text-secondary)]">
                {payloadStr}
              </div>
            </div>
          );
        },
        size: 320,
      },
      {
        id: "vector",
        header: "Vector Preview",
        cell: ({ row }) => {
          const vec = row.original.vector;
          if (!vec || vec.length === 0) {
            return (
              <span className="font-mono text-[10px] text-[var(--text-muted)]">
                (omitted)
              </span>
            );
          }
          const preview = vec
            .slice(0, 4)
            .map((n) => n.toFixed(3))
            .join(", ");
          return (
            <div className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--text-secondary)]">
              <span className="truncate">
                [{preview}, …] ({vec.length}d)
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void navigator.clipboard.writeText(JSON.stringify(vec));
                  toast.success("Copied full vector to clipboard");
                }}
                title="Copy full vector"
                className="shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          );
        },
        size: 200,
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectRecord(row.original);
              }}
              title="Inspect Record"
              className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFindSimilar(row.original);
              }}
              title="Find Similar Records"
              className="rounded p-1 text-[var(--accent-ai)] hover:bg-[var(--accent-ai)]/15 cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteRecords([row.original.id]);
              }}
              title="Delete Record"
              className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--status-error)]/15 hover:text-[var(--status-error)] cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ),
        size: 100,
      },
    );

    return base;
  }, [
    records.length,
    selectedKeys.length,
    checkedIds,
    showScore,
    onSelectRecord,
    onFindSimilar,
    onDeleteRecords,
  ]);

  const table = useLegacyTable({
    data: records,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const rows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 10,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Bulk Selection / Pagination Bar */}
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-4 py-1.5 text-[11px]">
        <div className="flex items-center gap-2 text-[var(--text-secondary)]">
          <span>
            Showing{" "}
            <span className="font-mono text-[var(--text-primary)]">
              {records.length}
            </span>
            {totalCount != null && (
              <>
                {" "}
                of{" "}
                <span className="font-mono text-[var(--text-primary)]">
                  {totalCount.toLocaleString()}
                </span>
              </>
            )}{" "}
            records
          </span>
          {selectedKeys.length > 0 && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => onDeleteRecords(selectedKeys)}
            >
              <Trash2 className="h-3 w-3" />
              Delete Selected ({selectedKeys.length})
            </Button>
          )}
        </div>

        {(onPrevPage || onNextPage) && (
          <div className="flex items-center gap-2">
            {pageInfo && (
              <span className="font-mono text-[10px] text-[var(--text-muted)]">
                {pageInfo}
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[10px]"
              disabled={!canPrev || loading}
              onClick={onPrevPage}
            >
              <ChevronLeft className="h-3 w-3" />
              Prev
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[10px]"
              disabled={!canNext || loading}
              onClick={onNextPage}
            >
              Next
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {/* Virtualized Table */}
      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 flex border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          {table.getHeaderGroups().map((hg) =>
            hg.headers.map((header) => (
              <div
                key={header.id}
                style={{
                  width: header.getSize(),
                  flex: header.id === "payload" ? "1 1 240px" : "0 0 auto",
                }}
                className="flex items-center px-3 py-2"
              >
                {header.isPlaceholder
                  ? null
                  : flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
              </div>
            )),
          )}
        </div>

        {records.length === 0 ? (
          <div className="py-14 text-center text-xs text-[var(--text-muted)]">
            {loading ? "Loading records..." : "No records match this query."}
          </div>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              position: "relative",
              width: "100%",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              const isSelected = selectedId === row.original.id;
              return (
                <div
                  key={row.id}
                  onClick={() => onSelectRecord(row.original)}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className={cn(
                    "flex items-center border-b border-[var(--border-subtle)] transition-colors cursor-pointer",
                    isSelected
                      ? "bg-[var(--accent-primary)]/10"
                      : "hover:bg-[var(--bg-elevated)]/60",
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <div
                      key={cell.id}
                      style={{
                        width: cell.column.getSize(),
                        flex:
                          cell.column.id === "payload"
                            ? "1 1 240px"
                            : "0 0 auto",
                      }}
                      className="min-w-0 px-3 py-1.5"
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
