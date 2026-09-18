import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const alertVariants = cva(
  "relative grid w-full grid-cols-[calc(var(--spacing)*4)_1fr] items-start gap-x-2.5 gap-y-1 rounded-md border px-3 py-2.5 text-sm [&>svg]:size-4 [&>svg]:translate-y-0.5",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-card-foreground",
        muted: "border-border bg-muted/50 text-foreground",
        warning:
          "border-amber-500/30 bg-amber-500/8 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400",
        destructive:
          "border-destructive/30 bg-destructive/8 text-destructive dark:bg-destructive/12 [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant, className }))}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("col-start-2 font-medium tracking-tight", className)}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn("col-start-2 text-xs leading-relaxed opacity-90", className)}
      {...props}
    />
  )
}

export { Alert, AlertDescription, AlertTitle }
