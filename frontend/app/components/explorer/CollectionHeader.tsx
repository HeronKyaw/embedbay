import {
  ArrowUpDown,
  DatabaseZap,
  Layers,
  Lock,
  Plus,
  RefreshCw,
  Repeat2,
  ScatterChart,
  Search,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import type { CollectionSchema } from "@/types/explorer";

export function CollectionHeader({
  schema,
  collectionName,
  loading,
  readOnly = false,
  onRefresh,
  onUpsertRecord,
  onOpenSearch,
  onOpenVisualizer,
  onOpenImportExport,
  onOpenMigrate,
  onOpenIndexes,
  onDeleteCollection,
}: {
  schema: CollectionSchema | null;
  collectionName: string;
  loading: boolean;
  readOnly?: boolean;
  onRefresh: () => void;
  onUpsertRecord: () => void;
  onOpenSearch: () => void;
  onOpenVisualizer?: () => void;
  onOpenImportExport?: () => void;
  onOpenMigrate?: () => void;
  onOpenIndexes?: () => void;
  onDeleteCollection: () => void;
}) {
  const displayName = schema?.name ?? collectionName;

  return (
    <div className="@container border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-4 py-3">
      <div className="grid grid-cols-1 items-center gap-x-3 gap-y-2 @min-[740px]:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 items-center gap-2">
          <Layers className="h-4 w-4 shrink-0 text-[var(--accent-primary)]" />
          <h2
            className="truncate text-sm font-semibold text-[var(--text-primary)]"
            title={displayName}
          >
            {displayName}
          </h2>
          {readOnly && (
            <Badge variant="warning" className="shrink-0 text-[10px]">
              <Lock className="h-2.5 w-2.5" />
              Read-Only
            </Badge>
          )}
        </div>

        <div className="flex min-h-5 flex-wrap items-center gap-1.5 @min-[740px]:col-span-2 @min-[740px]:row-start-2">
          {schema ? (
            <>
              <Badge variant="accent" className="font-mono">
                {schema.vector_count.toLocaleString()} records
              </Badge>
              {schema.dimensions != null && (
                <Badge variant="default" className="font-mono">
                  {schema.dimensions} dims
                </Badge>
              )}
              {schema.distance_metric && (
                <Badge variant="default" className="uppercase">
                  {schema.distance_metric}
                </Badge>
              )}
              {schema.index_type && (
                <Badge variant="default">{schema.index_type}</Badge>
              )}
              {schema.segment_count != null && (
                <Badge variant="default" className="font-mono">
                  {schema.segment_count} seg
                </Badge>
              )}
              {schema.disk_bytes != null && schema.disk_bytes > 0 && (
                <Badge variant="default" className="font-mono">
                  {formatBytes(schema.disk_bytes)}
                </Badge>
              )}
            </>
          ) : loading ? (
            <>
              <span className="sr-only">Loading collection metadata</span>
              <span
                aria-hidden="true"
                className="inline-block h-[18px] w-20 animate-pulse rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
              />
              <span
                aria-hidden="true"
                className="inline-block h-[18px] w-16 animate-pulse rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
              />
              <span
                aria-hidden="true"
                className="inline-block h-[18px] w-14 animate-pulse rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
              />
            </>
          ) : (
            <Badge variant="accent" className="font-mono">
              0 records
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 @min-[740px]:col-start-2 @min-[740px]:row-start-1 @min-[740px]:flex-nowrap @min-[740px]:justify-end">
          <Button
            type="button"
            size="sm"
            disabled={readOnly}
            title={readOnly ? "Disabled in Read-Only mode" : "Upsert Record"}
            onClick={onUpsertRecord}
          >
            <Plus className="h-3.5 w-3.5" />
            Upsert Record
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onOpenSearch}
          >
            <Search className="h-3.5 w-3.5 text-[var(--accent-ai)]" />
            Search Playground
          </Button>
          {onOpenVisualizer && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onOpenVisualizer}
            >
              <ScatterChart className="h-3.5 w-3.5 text-[var(--accent-secondary)]" />
              Visualize 2D/3D
            </Button>
          )}
          {onOpenImportExport && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenImportExport}
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              Import / Export
            </Button>
          )}
          {onOpenMigrate && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenMigrate}
            >
              <Repeat2 className="h-3.5 w-3.5" />
              Migrate
            </Button>
          )}
          {onOpenIndexes && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenIndexes}
            >
              <DatabaseZap className="h-3.5 w-3.5" />
              Indexes
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Refresh"
            onClick={onRefresh}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={readOnly}
            title={readOnly ? "Disabled in Read-Only mode" : "Delete Collection"}
            onClick={onDeleteCollection}
          >
            <Trash2 className="h-3.5 w-3.5 text-[var(--status-error)]" />
          </Button>
        </div>
      </div>
    </div>
  );
}
