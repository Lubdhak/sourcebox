import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"
import { cn } from "cn"

function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn("grid gap-2", className)}
      {...props}
    />
  )
}

/** The bare control, for a radio beside its own label. */
function RadioGroupItem({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      className={cn(
        "relative flex size-4 shrink-0 items-center justify-center rounded-full border border-input outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 data-checked:border-primary",
        className
      )}
      {...props}
    >
      <RadioPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="flex items-center justify-center before:size-2 before:rounded-full before:bg-primary before:content-['']"
      />
    </RadioPrimitive.Root>
  )
}

/**
 * A radio whose entire card is the control.
 *
 * The whole rectangle is the `Radio.Root`, rather than a `<label htmlFor>` wrapping a
 * separate control. That is not a style preference: Base UI renders a radio as a
 * `<button role="radio">`, and a label pointing at a button is inert in every browser —
 * the card would have looked clickable and done nothing. Rendering the card *as* the
 * radio gives the click, the keyboard, the role and an accessible name from the content
 * it already contains.
 */
function RadioGroupCard({
  className,
  children,
  ...props
}: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-card"
      className={cn(
        "group/radio-card flex w-full cursor-pointer items-start gap-2.5 rounded-md border border-border p-3 text-left outline-none transition-colors",
        "hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring",
        "data-checked:border-primary data-checked:bg-muted/40",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
      {...props}
    >
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-input transition-colors group-data-checked/radio-card:border-primary">
        <RadioPrimitive.Indicator
          data-slot="radio-group-indicator"
          className="flex items-center justify-center before:size-2 before:rounded-full before:bg-primary before:content-['']"
        />
      </span>
      {children}
    </RadioPrimitive.Root>
  )
}

export { RadioGroup, RadioGroupCard, RadioGroupItem }
