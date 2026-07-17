import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "interactive-surface inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] text-sm font-medium disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] focus-visible:ring-offset-0",
  {
    variants: {
      variant: {
        default: "bg-[var(--accent-solid)] text-accent-foreground shadow-[0_8px_24px_rgb(102_87_232_/_0.24),inset_0_1px_rgb(255_255_255_/_0.22)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-pressed)]",
        ghost: "hover:bg-[var(--surface-hover)] hover:text-foreground",
        outline: "border bg-[var(--surface-card)] shadow-[var(--shadow-low)] hover:bg-[var(--surface-hover)] hover:text-foreground",
        secondary: "bg-[var(--surface-glass-subtle)] text-foreground hover:bg-[var(--surface-hover)]",
      },
      size: {
        default: "h-[38px] px-4 py-2",
        sm: "h-8 px-3",
        lg: "h-[42px] px-8",
        icon: "h-[38px] w-[38px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
