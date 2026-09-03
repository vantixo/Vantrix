import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Three variants only, matching FRONTEND_DIRECTIVE §4 exactly:
 *   primary   — gold fill, for the single most important action on a view
 *   secondary — outline, gold border + text, transparent fill
 *   ghost     — no border, used inline / in dense rows (filter pills, nav)
 * Gold never appears as a large fill anywhere else in the app — see §1.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm font-sans font-semibold transition-[color,background-color,border-color,filter,box-shadow] duration-150 ease-premium disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        primary:
          "bg-gold-fill text-[#160F02] hover:brightness-110 active:brightness-95 shadow-[0_1px_0_0_rgba(255,255,255,0.25)_inset]",
        secondary:
          "border border-gold-500/50 text-gold-400 hover:border-gold-400 hover:text-gold-300 hover:bg-gold-500/5",
        ghost:
          "text-text-secondary hover:text-text-primary hover:bg-white/[0.04]",
        destructive: "bg-danger/90 text-white hover:bg-danger",
      },
      size: {
        sm: "h-9 px-4 text-sm",
        md: "h-11 px-6 text-[15px]",
        lg: "h-14 px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
