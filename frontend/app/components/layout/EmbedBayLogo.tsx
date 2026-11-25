import { cn } from "@/lib/utils";

export function EmbedBayLogo({
  className,
  size = 18,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <path
        d="M4.5 5.5V16.5C4.5 18.7091 6.29086 20.5 8.5 20.5H15.5C17.7091 20.5 19.5 18.7091 19.5 16.5V5.5"
        stroke="var(--accent-primary)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="8"
        y="7.5"
        width="2.4"
        height="7.5"
        rx="1.2"
        fill="var(--accent-primary)"
      />
      <rect
        x="10.8"
        y="4.5"
        width="2.4"
        height="10.5"
        rx="1.2"
        fill="var(--accent-secondary)"
      />
      <rect
        x="13.6"
        y="9"
        width="2.4"
        height="6"
        rx="1.2"
        fill="var(--accent-primary)"
      />
    </svg>
  );
}
