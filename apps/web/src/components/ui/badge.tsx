import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-kicker px-2 py-1 border",
  {
    variants: {
      variant: {
        default: "bg-transparent text-ink-dim border-hairline-strong",
        success: "bg-transparent text-phosphor border-phosphor/40",
        warning: "bg-transparent text-amber border-amber/40",
        destructive: "bg-transparent text-alert border-alert/40",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
