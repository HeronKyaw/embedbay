import {
  ArrowUpDown,
  Layers,
  Plus,
  RefreshCw,
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
  onRefresh,
  onUpsertRecord,
  onOpenSearch,
  onOpenVisualizer,
  onOpenImportExport,
  onDeleteCollection,
}: {
  schema: CollectionSchema | null;
  collectionName: string;
  loading: boolean;
  onRefresh: () => void;
  onUpsertRecord: () => void;
  onOpenSearch: () => void;
  onOpenVisualizer?: () => void;
  onOpenImportExport?: () => void;
  onDeleteCollection: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Layers className="h-4 w-4 text-[var(--accent-primary)]" />
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          {schema?.name ?? collectionName}
        </h2>
        <Badge variant="accent" className="font-mono">
          {(schema?.vector_count ?? 0).toLocaleString()} records
        </Badge>
        {schema?.dimensions != null && (
          <Badge variant="default" className="font-mono">
            {schema.dimensions} dims
          </Badge>
        )}
        {schema?.distance_metric && (
          <Badge variant="default" className="uppercase">
            {schema.distance_metric}
          </Badge>
        )}
        {schema?.index_type && (
          <Badge variant="default">{schema.index_type}</Badge>
        )}
        {schema?.segment_count != null && (
          <Badge variant="default" className="font-mono">
            {schema.segment_count} seg
          </Badge>
        )}
        {schema?.disk_bytes != null && schema.disk_bytes > 0 && (
          <Badge variant="default" className="font-mono">
            {formatBytes(schema.disk_bytes)}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" size="sm" onClick={onUpsertRecord}>
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
          title="Delete Collection"
          onClick={onDeleteCollection}
        >
          <Trash2 className="h-3.5 w-3.5 text-[var(--status-error)]" />
        </Button>
      </div>
    </div>
  );
}
