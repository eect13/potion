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
        <g className="fill-accent-foreground">
          <path d="M-3.9-12.15a3.9 1.55 0 0 1 7.8 0v2.2c0 .42-.4.75-.88.75h-6.04c-.48 0-.88-.33-.88-.75z" />
          <rect x="-3.95" y="-9.2" width="7.9" height="1.6" rx=".42" />
          <path d="M-1.7-7.6h3.4v2.5c2.15.95 5.7 3.05 5.7 8.2a7.85 8.15 0 1 1-15.7 0c0-5.15 3.55-7.25 5.7-8.2v-2.5z" />
        </g>
        <g className="fill-accent">
          <circle cx="-4.35" cy="2.55" r="1.05" />
          <circle cx="-3.15" cy="4.45" r=".48" />
          <g transform="skewX(-16)">
            <path
              fillRule="evenodd"
              d="M-2.7.15v8.55h1.72V5.2h1.42c2.42 0 3.82-1.28 3.82-3.12 0-1.84-1.32-1.93-3.55-1.93H-2.7zm1.72 1.48h1.48c1.18 0 1.88.36 1.88 1.22s-.7 1.3-1.88 1.3h-1.48V1.63z"
            />
          </g>
        </g>
      </g>
    </svg>
  );
}
