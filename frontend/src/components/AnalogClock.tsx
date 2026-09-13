import { useEffect, useRef, useState } from 'react'

function formatTime(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date)
}

function angles(date: Date) {
  const ms = date.getMilliseconds()
  const seconds = date.getSeconds() + ms / 1000
  const minutes = date.getMinutes() + seconds / 60
  const hours = (date.getHours() % 12) + minutes / 60
  return { hour: hours * 30, minute: minutes * 6, second: seconds * 6 }
}

/**
 * A live analog clock. Hands are rotated on the SVG itself so the face is not
 * re-rendered every frame. The caption updates once a second.
 *
 * `prefers-reduced-motion` skips the sweep and only moves the hands once a minute.
 */
export function AnalogClock({ className = '' }: { className?: string }) {
  const hourRef = useRef<SVGGElement>(null)
  const minuteRef = useRef<SVGGElement>(null)
  const secondRef = useRef<SVGGElement>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const apply = (date: Date) => {
      const { hour, minute, second } = angles(date)
      hourRef.current?.setAttribute('transform', `rotate(${hour} 100 100)`)
      minuteRef.current?.setAttribute('transform', `rotate(${minute} 100 100)`)
      secondRef.current?.setAttribute('transform', `rotate(${second} 100 100)`)
    }

    apply(new Date())

    if (reduce) {
      const id = window.setInterval(() => {
        const date = new Date()
        apply(date)
        setNow(date)
      }, 60_000)
      return () => window.clearInterval(id)
    }

    let frame = 0
    let lastCaptionSecond = new Date().getSeconds()
    const tick = () => {
      const date = new Date()
      apply(date)
      if (date.getSeconds() !== lastCaptionSecond) {
        lastCaptionSecond = date.getSeconds()
        setNow(date)
      }
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const label = formatTime(now)

  return (
    <figure className={`flex flex-col items-center ${className}`}>
      <svg
        viewBox="0 0 200 200"
        className="h-auto w-full drop-shadow-[0_24px_40px_rgba(0,0,0,0.28)]"
        role="img"
        aria-label={`Analog clock showing ${label}`}
      >
        <defs>
          <radialGradient id="clock-face" cx="50%" cy="38%" r="70%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#e8eef0" />
          </radialGradient>
          <linearGradient id="clock-bezel" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#c5d5d8" />
            <stop offset="50%" stopColor="#f7fbfb" />
            <stop offset="100%" stopColor="#9bb6bb" />
          </linearGradient>
        </defs>

        <circle cx="100" cy="100" r="98" fill="url(#clock-bezel)" />
        <circle cx="100" cy="100" r="90" fill="url(#clock-face)" />
        <circle cx="100" cy="100" r="86" fill="none" stroke="#006676" strokeWidth="1.25" opacity="0.35" />

        {Array.from({ length: 60 }, (_, i) => {
          const angle = (i * 6 * Math.PI) / 180
          const isHour = i % 5 === 0
          const inner = isHour ? 74 : 80
          const outer = 84
          return (
            <line
              key={i}
              x1={100 + inner * Math.sin(angle)}
              y1={100 - inner * Math.cos(angle)}
              x2={100 + outer * Math.sin(angle)}
              y2={100 - outer * Math.cos(angle)}
              stroke={isHour ? '#014e5b' : '#99cbd3'}
              strokeWidth={isHour ? 2.4 : 1}
              strokeLinecap="round"
            />
          )
        })}

        {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n, i) => {
          const angle = (i * 30 * Math.PI) / 180
          const r = 62
          return (
            <text
              key={n}
              x={100 + r * Math.sin(angle)}
              y={100 - r * Math.cos(angle)}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#014e5b"
              fontSize={n % 3 === 0 ? 16 : 11}
              fontWeight={n % 3 === 0 ? 700 : 500}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              {n}
            </text>
          )
        })}

        <g ref={hourRef}>
          <line x1="100" y1="112" x2="100" y2="52" stroke="#014e5b" strokeWidth="6" strokeLinecap="round" />
        </g>
        <g ref={minuteRef}>
          <line x1="100" y1="116" x2="100" y2="36" stroke="#006676" strokeWidth="4" strokeLinecap="round" />
        </g>
        <g ref={secondRef}>
          <line x1="100" y1="120" x2="100" y2="28" stroke="#f43e36" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="100" cy="28" r="2.4" fill="#f43e36" />
        </g>

        <circle cx="100" cy="100" r="5.5" fill="#014e5b" />
        <circle cx="100" cy="100" r="2.4" fill="#fff" />
      </svg>

      <figcaption className="mt-6 text-center">
        <p className="text-2xl font-light tracking-wide text-white tabular-nums" aria-hidden="true">
          {label}
        </p>
        <p className="mt-1 text-sm text-white/70">{formatDate(now)}</p>
      </figcaption>
    </figure>
  )
}
