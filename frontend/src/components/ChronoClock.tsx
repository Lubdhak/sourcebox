import { useEffect, useId, useRef } from 'react'

const CX = 120
const CY = 120

/** The three rings, outermost first: twelve hours, sixty minutes, sixty seconds. */
const R_HOUR = 104
const R_MINUTE = 92
const R_SECOND = 80

const C_HOUR = 2 * Math.PI * R_HOUR
const C_MINUTE = 2 * Math.PI * R_MINUTE
const C_SECOND = 2 * Math.PI * R_SECOND

/** How far the corners are cut off the frame. The shape the whole thing is named for. */
const CUT = 26

const DAY_MS = 86_400_000
const BAR_X = 84
const BAR_WIDTH = 72

const HOUR_MINUTE = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

const LONG_DATE = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})

const TIME_ZONE = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  timeZoneName: 'short',
})

/**
 * Reads the clock through `Intl` rather than off `getHours`, so a 24-hour locale gets
 * 24-hour time and no locale gets an AM/PM that it does not use.
 */
function readClock(date: Date) {
  let hour = ''
  let minute = ''
  let period = ''

  for (const part of HOUR_MINUTE.formatToParts(date)) {
    if (part.type === 'hour') hour = part.value
    else if (part.type === 'minute') minute = part.value
    else if (part.type === 'dayPeriod') period = part.value
  }

  return { hour: hour.padStart(2, '0'), minute, period: period.toUpperCase() }
}

/** "GMT+5:30" and the like, for the line that says which clock this is. */
function readZone(date: Date) {
  return TIME_ZONE.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value ?? ''
}

/** Midnight-to-now as a fraction, which is what the bar under the readout measures. */
function dayProgress(date: Date) {
  const midnight = new Date(date)
  midnight.setHours(0, 0, 0, 0)

  return (date.getTime() - midnight.getTime()) / DAY_MS
}

/**
 * The clock on the sign-in panel: three concentric progress rings, a digital readout, and
 * a sweep head riding the seconds ring.
 *
 * Rings rather than hands because a ring says two things at once -- where in the cycle we
 * are, and how much of it is spent -- and stacking hours, minutes and seconds as three of
 * them turns a watch face into a gauge that can be read from across the room. The hard
 * part of a dial is the eye having to measure an angle; a filled arc removes it.
 *
 * Nothing here re-renders. After mount the whole component is a fixed tree, and the frame
 * loop writes to the four attributes and three text nodes that actually change -- a
 * `setState` per frame would rebuild sixty tick marks to move one dot. `prefers-reduced-
 * motion` drops the sweep and steps once a second instead.
 */
export function ChronoClock({ className = '' }: { className?: string }) {
  const rawId = useId()
  const uid = rawId.replace(/:/g, '')

  const svg = useRef<SVGSVGElement>(null)
  const hourArc = useRef<SVGCircleElement>(null)
  const minuteArc = useRef<SVGCircleElement>(null)
  const secondArc = useRef<SVGCircleElement>(null)
  const sweep = useRef<SVGGElement>(null)
  const clockText = useRef<SVGTextElement>(null)
  const secondText = useRef<SVGTextElement>(null)
  const percentText = useRef<SVGTextElement>(null)
  const dayBar = useRef<SVGRectElement>(null)
  const dateText = useRef<HTMLParagraphElement>(null)

  // First paint comes from the same functions the loop uses, so the clock is never
  // briefly wrong -- it is right before React has finished mounting it.
  const mount = useRef(new Date())
  const initial = readClock(mount.current)

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let lastSecond = -1
    let lastMinute = -1

    const paint = (date: Date) => {
      // Sub-second position is what makes the seconds ring sweep instead of tick. Dropped
      // under reduced motion, where the whole point is that nothing moves continuously.
      const fraction = reduce ? 0 : date.getMilliseconds() / 1000
      const seconds = date.getSeconds() + fraction
      const minutes = date.getMinutes() + seconds / 60
      const hours = (date.getHours() % 12) + minutes / 60

      hourArc.current?.setAttribute('stroke-dashoffset', String(C_HOUR * (1 - hours / 12)))
      minuteArc.current?.setAttribute('stroke-dashoffset', String(C_MINUTE * (1 - minutes / 60)))
      secondArc.current?.setAttribute('stroke-dashoffset', String(C_SECOND * (1 - seconds / 60)))
      sweep.current?.setAttribute('transform', `rotate(${seconds * 6} ${CX} ${CY})`)

      const second = date.getSeconds()
      if (second === lastSecond) return
      lastSecond = second

      const progress = dayProgress(date)
      secondText.current!.textContent = String(second).padStart(2, '0')
      percentText.current!.textContent = `${Math.round(progress * 100)}% OF DAY`
      dayBar.current?.setAttribute('width', String(Math.max(progress * BAR_WIDTH, 0.5)))

      const minute = date.getMinutes()
      if (minute === lastMinute) return
      lastMinute = minute

      const { hour, minute: mm, period } = readClock(date)
      clockText.current!.textContent = `${hour}:${mm}`
      dateText.current!.textContent = LONG_DATE.format(date)
      // Once a minute, because this is what a screen reader reads out: seconds would make
      // it unusable, and the digits on screen are hidden from it for the same reason.
      svg.current?.setAttribute(
        'aria-label',
        `Clock showing ${hour}:${mm}${period ? ` ${period}` : ''}`,
      )
    }

    paint(new Date())

    if (reduce) {
      const id = window.setInterval(() => paint(new Date()), 1000)
      return () => window.clearInterval(id)
    }

    let frame = window.requestAnimationFrame(function tick() {
      paint(new Date())
      frame = window.requestAnimationFrame(tick)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [])

  return (
    <figure className={`flex flex-col items-center ${className}`}>
      <svg
        ref={svg}
        viewBox="0 0 240 240"
        className="h-auto w-full"
        role="img"
        aria-label="Clock"
      >
        <defs>
          {/*
            One gradient per ring, each running from its own hue into the next one out, so
            the three read as a single instrument lit from one side rather than as three
            unrelated coloured circles.
          */}
          <linearGradient id={`${uid}-hour`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7defff" />
            <stop offset="100%" stopColor="#2bb7d4" />
          </linearGradient>
          <linearGradient id={`${uid}-minute`} x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4ef5c5" />
            <stop offset="100%" stopColor="#12b48c" />
          </linearGradient>
          <linearGradient id={`${uid}-second`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#e8ff8a" />
            <stop offset="100%" stopColor="#9ff05a" />
          </linearGradient>
          <radialGradient id={`${uid}-well`} cx="38%" cy="28%" r="80%">
            <stop offset="0%" stopColor="rgba(13,86,99,0.65)" />
            <stop offset="55%" stopColor="rgba(3,40,50,0.55)" />
            <stop offset="100%" stopColor="rgba(1,21,28,0.75)" />
          </radialGradient>

          {/* What makes the strokes look lit rather than drawn: the shape, blurred, put
              back underneath itself. */}
          <filter id={`${uid}-glow`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.4" result="halo" />
            <feMerge>
              <feMergeNode in="halo" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={`${uid}-text-glow`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="1.6" result="halo" />
            <feMerge>
              <feMergeNode in="halo" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* The cut corners. An octagon rather than a circle because the rings inside are
            already round, and a square frame around them would read as a picture. */}
        <path
          d={`M ${CUT} 3 H ${240 - CUT} L 237 ${CUT} V ${240 - CUT} L ${240 - CUT} 237 H ${CUT} L 3 ${240 - CUT} V ${CUT} Z`}
          fill={`url(#${uid}-well)`}
          stroke="rgba(125,239,255,0.28)"
          strokeWidth="1.2"
        />

        {/* Brackets on the cuts, drawn only as far as the eye needs to close the corner. */}
        {[
          [CUT, 3, 3, CUT],
          [240 - CUT, 3, 237, CUT],
          [237, 240 - CUT, 240 - CUT, 237],
          [3, 240 - CUT, CUT, 237],
        ].map(([x1, y1, x2, y2]) => (
          <line
            key={`${x1}-${y1}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="#7defff"
            strokeWidth="2"
            strokeLinecap="round"
          />
        ))}

        {/* Sixty ticks: the scale the seconds ring is read against, brighter every five. */}
        <g>
          {Array.from({ length: 60 }, (_, i) => {
            const angle = (i * Math.PI) / 30
            const major = i % 5 === 0
            const inner = major ? 108 : 111
            return (
              <line
                key={i}
                x1={CX + inner * Math.sin(angle)}
                y1={CY - inner * Math.cos(angle)}
                x2={CX + 115 * Math.sin(angle)}
                y2={CY - 115 * Math.cos(angle)}
                stroke={major ? 'rgba(125,239,255,0.75)' : 'rgba(210,255,255,0.22)'}
                strokeWidth={major ? 1.6 : 0.8}
                strokeLinecap="round"
              />
            )
          })}
        </g>

        {/* Unfilled ring beds, so an arc that is nearly empty still shows what it is part
            of -- a gauge with no scale is a bar with no meaning. */}
        {[R_HOUR, R_MINUTE, R_SECOND].map((r) => (
          <circle
            key={r}
            cx={CX}
            cy={CY}
            r={r}
            fill="none"
            stroke="rgba(160,240,255,0.13)"
            strokeWidth="4"
          />
        ))}

        {/*
          The arcs themselves. Each is a full circle whose dash is exactly its own
          circumference, so moving the dash offset is the same thing as filling it -- one
          attribute per ring per frame, and no path arithmetic.

          Rotated to start at twelve o'clock, where a clock starts.
        */}
        <g filter={`url(#${uid}-glow)`} transform={`rotate(-90 ${CX} ${CY})`}>
          <circle
            ref={hourArc}
            cx={CX}
            cy={CY}
            r={R_HOUR}
            fill="none"
            stroke={`url(#${uid}-hour)`}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={C_HOUR}
            strokeDashoffset={C_HOUR}
          />
          <circle
            ref={minuteArc}
            cx={CX}
            cy={CY}
            r={R_MINUTE}
            fill="none"
            stroke={`url(#${uid}-minute)`}
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeDasharray={C_MINUTE}
            strokeDashoffset={C_MINUTE}
          />
          <circle
            ref={secondArc}
            cx={CX}
            cy={CY}
            r={R_SECOND}
            fill="none"
            stroke={`url(#${uid}-second)`}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeDasharray={C_SECOND}
            strokeDashoffset={C_SECOND}
          />
        </g>

        {/* The head of the seconds arc, which is the only part that is worth following at
            a glance -- and the one piece of the instrument that is obviously alive. */}
        <g ref={sweep}>
          <g filter={`url(#${uid}-glow)`}>
            <circle cx={CX} cy={CY - R_SECOND} r="3.4" fill="#e8ff8a" />
            <line
              x1={CX}
              y1={CY - R_SECOND + 9}
              x2={CX}
              y2={CY - R_SECOND - 9}
              stroke="rgba(232,255,138,0.55)"
              strokeWidth="1.1"
              strokeLinecap="round"
            />
          </g>
        </g>

        {/* A dashed ring turning far slower than any hand, for depth behind the readout.
            Decoration, and the only thing here that is: it carries no value. */}
        <circle
          cx={CX}
          cy={CY}
          r="64"
          fill="none"
          stroke="rgba(125,239,255,0.18)"
          strokeWidth="0.9"
          strokeDasharray="2 7"
          className="origin-center animate-orbit"
        />

        <text
          x={CX}
          y={96}
          textAnchor="middle"
          fill="rgba(198,245,255,0.6)"
          fontSize="6.6"
          fontWeight={600}
          letterSpacing="3.4"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        >
          LOCAL TIME
        </text>

        {/* Digits as well as rings: the rings are for reading the shape of the hour, and
            this is for when you want the number. Hidden from assistive tech, which is
            served the label on the <svg> once a minute instead. */}
        <text
          ref={clockText}
          x={CX}
          y={129}
          textAnchor="middle"
          fill="#f2feff"
          fontSize="38"
          fontWeight={300}
          letterSpacing="-0.5"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          filter={`url(#${uid}-text-glow)`}
          aria-hidden="true"
        >
          {`${initial.hour}:${initial.minute}`}
        </text>

        {/*
          Seconds, in the colour of the ring they belong to. Beside them the AM/PM, and
          only where the locale has one -- a 24-hour clock has nothing to put here, and
          the timezone is not it: that belongs to the caption, where it is read once,
          rather than to the middle of a readout that changes every second.
        */}
        <g aria-hidden="true">
          <text
            ref={secondText}
            x={initial.period ? CX - 13 : CX}
            y={146}
            textAnchor="middle"
            fill="#d9f96b"
            fontSize="11"
            fontWeight={500}
            letterSpacing="1"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            {String(mount.current.getSeconds()).padStart(2, '0')}
          </text>
          {initial.period ? (
            <text
              x={CX + 17}
              y={146}
              textAnchor="middle"
              fill="rgba(198,245,255,0.75)"
              fontSize="8.4"
              fontWeight={600}
              letterSpacing="1.4"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              {initial.period}
            </text>
          ) : null}
        </g>

        {/*
          How much of the day has gone. The one reading a clock face cannot give you, and
          the reason this is an instrument rather than an ornament: "half past four" is a
          position, "68% of the day" is a quantity.
        */}
        <g aria-hidden="true">
          <rect
            x={BAR_X}
            y={162}
            width={BAR_WIDTH}
            height="2.4"
            rx="1.2"
            fill="rgba(160,240,255,0.16)"
          />
          <rect
            ref={dayBar}
            x={BAR_X}
            y={162}
            width={Math.max(dayProgress(mount.current) * BAR_WIDTH, 0.5)}
            height="2.4"
            rx="1.2"
            fill={`url(#${uid}-hour)`}
            filter={`url(#${uid}-text-glow)`}
          />
          <text
            ref={percentText}
            x={CX}
            y={178}
            textAnchor="middle"
            fill="rgba(198,245,255,0.55)"
            fontSize="6.4"
            fontWeight={600}
            letterSpacing="2.2"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            {`${Math.round(dayProgress(mount.current) * 100)}% OF DAY`}
          </text>
        </g>
      </svg>

      <figcaption className="mt-6 text-center">
        <p ref={dateText} className="text-sm font-light tracking-wide text-white/80">
          {LONG_DATE.format(mount.current)}
        </p>
        <p className="mt-1 font-mono text-[11px] tracking-[0.2em] text-[#7defff]/70 uppercase">
          {readZone(mount.current)}
        </p>
      </figcaption>
    </figure>
  )
}
