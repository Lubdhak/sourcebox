import { RadioGroup, RadioGroupCard } from '@/components/ui/radio-group'

/**
 * One section of the decision: a label, and a stack of option cards.
 *
 * Serves both the deletion type and what happens to the nodes inside, because they are
 * the same control with different words. Building two of them would have meant two places to
 * fix the click target, and the click target matters here — the whole card is the radio,
 * so anywhere in it selects the option. A four-pixel circle is not a decision surface.
 *
 * Generic over the value type so each caller keeps its own union instead of widening to
 * `string` and losing the exhaustiveness check at the call site.
 */
export function PolicySelector<T extends string>({
  section,
  description,
  value,
  options,
  disabled,
  onChange,
}: {
  section: string
  description?: string
  value: T
  options: { value: T; title: string; lines: string[] }[]
  disabled?: boolean
  onChange: (value: T) => void
}) {
  return (
    // `fieldset` + `legend` rather than a div and a heading: the legend is what names the
    // group to a screen reader, and `disabled` on the fieldset reaches every card without
    // each one having to be told.
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {section}
      </legend>

      {description ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
      ) : null}

      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as T)}
        aria-label={section}
      >
        {options.map((option) => (
          <RadioGroupCard key={option.value} value={option.value}>
            <span className="space-y-0.5">
              <span className="block text-sm leading-none font-medium">{option.title}</span>
              {option.lines.map((line) => (
                <span key={line} className="block text-xs leading-relaxed text-muted-foreground">
                  {line}
                </span>
              ))}
            </span>
          </RadioGroupCard>
        ))}
      </RadioGroup>
    </fieldset>
  )
}
