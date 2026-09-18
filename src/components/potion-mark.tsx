import { cn } from "@/lib/utils";

export function PotionMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("shrink-0", className)}
      aria-hidden
      fill="none"
    >
      <rect width="32" height="32" rx="8" className="fill-accent" />
      <g transform="translate(16 16)">
        <path
          d="M-4.7-12.3h9.4c.7 0 1.2.5 1.2 1.15v1.55H-5.9v-1.55c0-.65.5-1.15 1.2-1.15z"
          className="fill-accent-foreground"
        />
        <rect x="-4.3" y="-9.6" width="8.6" height="1.85" rx="0.5" className="fill-accent-foreground" />
        <path
          d="M-2.45-7.75h4.9v3.15c2.55 1.2 6.15 3.45 6.15 8.85a8.6 8.6 0 1 1-17.2 0c0-5.4 3.6-7.65 6.15-8.85v-3.15z"
          className="fill-accent-foreground"
        />
        <path
          d="M-3.05-.35v9.15h1.95V5.25h1.55c2.7 0 4.25-1.4 4.25-3.45 0-2.05-1.45-2.15-3.95-2.15H-3.05zm1.95 1.65h1.7c1.35 0 2.15.4 2.15 1.35s-.8 1.45-2.15 1.45h-1.7V1.3z"
          className="fill-accent"
        />
      </g>
    </svg>
  );
}
