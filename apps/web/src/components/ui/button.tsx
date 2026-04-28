import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-kicker transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber disabled:pointer-events-none disabled:opacity-40 select-none",
  {
    variants: {
      variant: {
        default:
          "bg-amber text-bg hover:bg-[#ffc33d] border border-amber hover:border-[#ffc33d]",
        primary:
          "bg-amber text-bg hover:bg-[#ffc33d] border border-amber hover:border-[#ffc33d]",
        destructive:
          "bg-transparent text-alert border border-alert/50 hover:bg-alert hover:text-bg hover:border-alert",
        outline:
          "bg-transparent text-ink border border-hairline-strong hover:border-amber hover:text-amber",
        ghost:
          "bg-transparent text-ink-dim hover:text-amber border border-transparent hover:border-hairline-strong",
      },
      size: {
        default: "h-10 px-5",
        sm: "h-8 px-3 text-[10px]",
        lg: "h-12 px-8 text-[12px]",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  )
);
Button.displayName = "Button";

export { Button, buttonVariants };
