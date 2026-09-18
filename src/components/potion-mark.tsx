import { cn } from "@/lib/utils";

/** Your flask PNG, scaled to fit. Shape is not redrawn. */
export function PotionMark({ className }: { className?: string }) {
  return (
    <span
      className={cn("relative inline-block shrink-0 overflow-hidden rounded-[25%] bg-accent", className)}
      aria-hidden
    >
      <span className="potion-logo-mask absolute inset-[14%] bg-accent-foreground" />
    </span>
  );
}
