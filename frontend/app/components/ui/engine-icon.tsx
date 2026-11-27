import { cn } from "@/lib/utils";

export type EngineIconSize = "xs" | "sm" | "md" | "lg";

const SIZE_CLASSES: Record<
  EngineIconSize,
  { box: string; svg: string }
> = {
  xs: { box: "h-4 w-4 rounded", svg: "h-3 w-3" },
  sm: { box: "h-5 w-5 rounded-md", svg: "h-3.5 w-3.5" },
  md: { box: "h-8 w-8 rounded-lg", svg: "h-[18px] w-[18px]" },
  lg: { box: "h-11 w-11 rounded-xl", svg: "h-6 w-6" },
};

const ENGINE_TONES: Record<string, string> = {
  qdrant: "border-[#DC244C]/35 bg-[#DC244C]/12",
  chroma: "border-[#FF6446]/35 bg-[#FF6446]/12",
  lancedb: "border-[#F97316]/35 bg-[#F97316]/12",
  pgvector: "border-[#3B82F6]/35 bg-[#3B82F6]/12",
  meilisearch: "border-[#FF5CAA]/35 bg-[#FF5CAA]/12",
  surrealdb: "border-[#E83E8C]/35 bg-[#E83E8C]/12",
  elasticsearch: "border-[#00BFB3]/35 bg-[#00BFB3]/12",
  opensearch: "border-[#0095D5]/35 bg-[#0095D5]/12",
  mariadb: "border-[#00869B]/35 bg-[#00869B]/12",
  sqlite_vec: "border-[#0EA5E9]/35 bg-[#0EA5E9]/12",
  duckdb: "border-[#FACC15]/35 bg-[#FACC15]/12",
  pinecone: "border-[#10B981]/35 bg-[#10B981]/12",
  weaviate: "border-[#4ADE80]/35 bg-[#4ADE80]/12",
  milvus: "border-[#00A1EA]/35 bg-[#00A1EA]/12",
  redis_stack: "border-[#EF4444]/35 bg-[#EF4444]/12",
};

function normalizeEngineKey(engineType: string): string {
  return engineType.trim().toLowerCase().replace(/-/g, "_");
}

function renderEngineGlyph(key: string, svgClass: string) {
  switch (key) {
    case "qdrant":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={svgClass} aria-hidden="true">
          <path
            d="M12 2.5L20 7.1v9.8L12 21.5 4 16.9V7.1L12 2.5z"
            stroke="#DC244C"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M12 7.5L15.8 9.7v4.6L12 16.5l-3.8-2.2V9.7L12 7.5z"
            fill="#DC244C"
          />
          <path
            d="M14.5 14.5L19 18.5"
            stroke="#DC244C"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
      );
    case "chroma":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={svgClass} aria-hidden="true">
          <circle cx="9.5" cy="12" r="5.5" fill="#FF6446" fillOpacity="0.88" />
          <circle cx="14.5" cy="12" r="5.5" fill="#3B82F6" fillOpacity="0.85" />
          <path
            d="M12 7.2a5.5 5.5 0 0 1 0 9.6 5.5 5.5 0 0 1 0-9.6z"
            fill="#FACC15"
          />
        </svg>
      );
    case "lancedb":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={svgClass} aria-hidden="true">
          <path
            d="M5 17.5L15.5 4.5l3.5 3-7 9h6.5L16 20H5v-2.5z"
            fill="#F97316"
          />
          <circle cx="17.5" cy="6" r="1.5" fill="#FDBA74" />
        </svg>
      );
    case "pgvector":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={svgClass} aria-hidden="true">
          <path
            d="M12 3l7.5 3v6.2c0 4.5-3.2 7.7-7.5 8.8-4.3-1.1-7.5-4.3-7.5-8.8V6L12 3z"
            stroke="#3B82F6"
            strokeWidth="1.9"
            fill="#336791"
            fillOpacity="0.28"
          />
          <circle cx="9.5" cy="10.5" r="1.5" fill="#60A5FA" />
          <circle cx="14.5" cy="10.5" r="1.5" fill="#60A5FA" />
          <circle cx="12" cy="15" r="1.5" fill="#93C5FD" />
          <path
            d="M9.5 10.5h5M9.5 10.5L12 15l2.5-4.5"
            stroke="#60A5FA"
            strokeWidth="1.3"
          />
        </svg>
      );
    case "meilisearch":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={svgClass} aria-hidden="true">
          <path
            d="M4 18L8.2 6h3.2L7.2 18H4zm5.8 0L14 6h3.2L13 18H9.8zm5.8 0L19.8 6H23l-4.2 12h-3.2z"
            fill="#FF5CAA"
          />
        </svg>
      );
    case "surrealdb":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={svgClass} aria-hidden="true">
          <path
            d="M17.5 7.5C17.5 5.5 15 4.5 12 4.5S6.5 5.7 6.5 7.8c0 2.5 3.1 3.3 5.8 4 2.7.7 5.2 1.5 5.2 4 0 2.2-2.4 3.7-5.5 3.7s-5.5-1.2-5.5-3.3"
            stroke="#E83E8C"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
        </svg>
      );
    case "elasticsearch":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={svgClass} aria-hidden="true">
          <path
            d="M5.5 8.5A7.5 7.5 0 0 1 17 5.2"
            stroke="#FEC514"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M4.5 12h11.5"
            stroke="#00BFB3"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M5.5 15.5A7.5 7.5 0 0 0 17 18.8"
            stroke="#0077CC"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      );
    case "opensearch":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={svgClass} aria-hidden="true">
          <circle cx="12" cy="12" r="7.5" stroke="#0095D5" strokeWidth="2.3" />
          <path
            d="M12 7.2a4.8 4.8 0 0 1 4.8 4.8"
            stroke="#38BDF8"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <circle cx="12" cy="12" r="2.1" fill="#0095D5" />
        </svg>
      );
    case "mariadb":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={svgClass} aria-hidden="true">
          <path
            d="M4 15.5c2.5-4.5 5.8-7 9.8-7 2.8 0 4.8 1.2 6.2 3.3-2.4-.5-4.4 0-5.9 1.6 1.6.4 3 1.4 4 2.8-2.6.9-5.8 1.1-9.1.4-2.1-.4-3.7-.7-5-1.1z"
            fill="#00869B"
          />
          <circle cx="15" cy="11" r="1.1" fill="#FDBA74" />
        </svg>
      );
    case "sqlite_vec":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={svgClass} aria-hidden="true">
          <ellipse cx="12" cy="6.5" rx="6.5" ry="2.5" stroke="#0EA5E9" strokeWidth="1.9" />
          <path
            d="M5.5 6.5v11c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-11"
            stroke="#0EA5E9"
            strokeWidth="1.9"
          />
          <path
            d="M5.5 12c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5"
            stroke="#38BDF8"
            strokeWidth="1.5"
          />
        </svg>
      );
    case "duckdb":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={svgClass} aria-hidden="true">
          <circle cx="10.5" cy="12" r="6.2" fill="#FACC15" />
          <path d="M15.5 10.5h4.5l-1.2 3h-3.3v-3z" fill="#F59E0B" />
          <circle cx="11.5" cy="10.2" r="1.1" fill="#0F172A" />
        </svg>
      );
    case "pinecone":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={svgClass} aria-hidden="true">
          <path
            d="M12 3l6.5 6.5L12 21 5.5 9.5 12 3z"
            stroke="#10B981"
            strokeWidth="2"
            fill="#10B981"
            fillOpacity="0.2"
            strokeLinejoin="round"
          />
          <path
            d="M8.2 9.5h7.6M9.6 13.2h4.8"
            stroke="#34D399"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      );
    case "weaviate":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={svgClass} aria-hidden="true">
          <path
            d="M4 7.5l3.5 9 3.3-6.5 3.2 6.5L18 7.5"
            stroke="#4ADE80"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="19.5" cy="7.5" r="1.5" fill="#22C55E" />
        </svg>
      );
    case "milvus":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={svgClass} aria-hidden="true">
          <path
            d="M4.5 18V7.5L12 13.5l7.5-6V18"
            stroke="#00A1EA"
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="6.5" r="1.6" fill="#38BDF8" />
        </svg>
      );
    case "redis_stack":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={svgClass} aria-hidden="true">
          <path d="M12 4l7.5 3.5L12 11 4.5 7.5 12 4z" fill="#EF4444" />
          <path
            d="M4.5 12L12 15.5 19.5 12M4.5 16.2L12 19.7l7.5-3.5"
            stroke="#F87171"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" className={svgClass} aria-hidden="true">
          <ellipse cx="12" cy="7" rx="6.5" ry="2.5" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M5.5 7v10c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V7"
            stroke="currentColor"
            strokeWidth="1.8"
          />
        </svg>
      );
  }
}

/** Branded geometric icon badge for a local or remote vector database engine. */
export function EngineIcon({
  engineType,
  size = "md",
  className,
}: {
  engineType: string;
  size?: EngineIconSize;
  className?: string;
}) {
  const key = normalizeEngineKey(engineType);
  const toneClass =
    ENGINE_TONES[key] ??
    "border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--accent-primary)]";
  const dims = SIZE_CLASSES[size];

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center border",
        dims.box,
        toneClass,
        className,
      )}
    >
      {renderEngineGlyph(key, dims.svg)}
    </span>
  );
}
