import * as React from "react";
import { cn } from "@/lib/utils";

export function EmbedBayLogo({
  className,
  size = 18,
}: {
  className?: string;
  size?: number;
}) {
  const uid = React.useId().replace(/:/g, "");
  const bgId = `${uid}-bg`;
  const rimId = `${uid}-rim`;
  const tealId = `${uid}-teal`;
  const cyanId = `${uid}-cyan`;
  const bayId = `${uid}-bay`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={bgId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1E2530" />
          <stop offset="50%" stopColor="#131822" />
          <stop offset="100%" stopColor="#0B0F16" />
        </linearGradient>
        <linearGradient id={rimId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#94A3B8" stopOpacity="0.82" />
          <stop offset="50%" stopColor="#475569" stopOpacity="0.48" />
          <stop offset="100%" stopColor="#334155" stopOpacity="0.68" />
        </linearGradient>
        <linearGradient id={tealId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2DD4BF" />
          <stop offset="100%" stopColor="#14B8A6" />
        </linearGradient>
        <linearGradient id={cyanId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#60A5FA" />
          <stop offset="45%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#0EA5E9" />
        </linearGradient>
        <linearGradient id={bayId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2DD4BF" />
          <stop offset="100%" stopColor="#0D9488" />
        </linearGradient>
      </defs>

      <rect
        x="48"
        y="48"
        width="928"
        height="928"
        rx="220"
        ry="220"
        fill={`url(#${bgId})`}
      />
      <rect
        x="56"
        y="56"
        width="912"
        height="912"
        rx="212"
        ry="212"
        fill="none"
        stroke={`url(#${rimId})`}
        strokeWidth="16"
      />

      {/* U-Shaped Docking Bay Bracket */}
      <path
        d="M 358 456 L 292 456 Q 264 456 264 484 L 264 700 Q 264 728 292 728 L 732 728 Q 760 728 760 700 L 760 484 Q 760 456 732 456 L 666 456"
        fill="none"
        stroke={`url(#${bayId})`}
        strokeWidth="52"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Bottom Layer */}
      <path
        d="M 378 494 L 512 574 L 646 494 L 604 468 L 512 522 L 420 468 Z"
        fill={`url(#${tealId})`}
        stroke={`url(#${tealId})`}
        strokeWidth="10"
        strokeLinejoin="round"
      />

      {/* Middle Layer */}
      <path
        d="M 378 424 L 512 504 L 646 424 L 604 398 L 512 452 L 420 398 Z"
        fill={`url(#${cyanId})`}
        stroke={`url(#${cyanId})`}
        strokeWidth="10"
        strokeLinejoin="round"
      />

      {/* Top Layer */}
      <path
        d="M 512 280 L 646 356 L 512 432 L 378 356 Z"
        fill={`url(#${tealId})`}
        stroke={`url(#${tealId})`}
        strokeWidth="12"
        strokeLinejoin="round"
      />

      {/* Inner Bay Telemetry Bars */}
      <rect x="358" y="576" width="84" height="28" rx="14" fill="#14B8A6" />
      <rect x="358" y="624" width="202" height="28" rx="14" fill="#14B8A6" />
      <rect x="588" y="576" width="80" height="28" rx="14" fill="#38BDF8" />
    </svg>
  );
}
