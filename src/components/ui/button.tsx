import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-center text-sm font-semibold break-words whitespace-normal transition-transform duration-150 ease-out sm:px-4 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-navy text-card hover:bg-navy-2",
        cyan: "bg-cyan text-card hover:bg-cyan-2",
        ghost: "bg-line/40 text-navy hover:bg-line",
        danger: "bg-danger-soft text-danger hover:bg-danger-soft/80",
        outline: "border border-line bg-card text-ink hover:bg-paper",
      },
      width: {
        auto: "",
        full: "w-full",
      },
    },
    defaultVariants: { variant: "primary", width: "auto" },
  },
);

export function Button({
  className,
  variant,
  width,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, width }), className)} {...props} />;
}
