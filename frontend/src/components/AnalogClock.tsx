import { useEffect, useId, useRef, useState } from 'react'

const CX = 110
const CY = 110
const DIAL_R = 96
const SUB_X = 110
const SUB_Y = 164
const SUB_R = 22

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

function HourIndex({ hour, uid }: { hour: number; uid: string }) {
  const double = hour === 0 || hour === 3 || hour === 9
  const y = -(DIAL_R - 5)
  return (
    <g transform={`rotate(${hour * 30} ${CX} ${CY})`}>
      <g transform={`translate(${CX} ${CY})`}>
        {double ? (
          <>
            <rect x={-5.4} y={y} width={3.3} height={16.8} rx={0.7} fill={`url(#${uid}-index)`} />
            <rect x={2.1} y={y} width={3.3} height={16.8} rx={0.7} fill={`url(#${uid}-index)`} />
          </>
        ) : (
          <rect x={-2.15} y={y} width={4.4} height={14.6} rx={0.7} fill={`url(#${uid}-index)`} />
        )}
      </g>
    </g>
  )
}

/**
 * Sports-watch dial: textured blue sunburst, applied steel markers, faceted
 * hands, and a small-seconds register at 6. Hands are rotated on the SVG so the
 * face is not re-rendered every frame.
 *
 * `prefers-reduced-motion` skips the sweep and only moves the hands once a minute.
 */
export function AnalogClock({ className = '' }: { className?: string }) {
  const rawId = useId()
  const uid = rawId.replace(/:/g, '')
  const hourRef = useRef<SVGGElement>(null)
  const minuteRef = useRef<SVGGElement>(null)
  const secondRef = useRef<SVGGElement>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const apply = (date: Date) => {
      const { hour, minute, second } = angles(date)
      hourRef.current?.setAttribute('transform', `rotate(${hour} ${CX} ${CY})`)
      minuteRef.current?.setAttribute('transform', `rotate(${minute} ${CX} ${CY})`)
      secondRef.current?.setAttribute('transform', `rotate(${second} ${SUB_X} ${SUB_Y})`)
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
        viewBox="0 0 220 220"
        className="h-auto w-full drop-shadow-[0_28px_36px_rgba(0,0,0,0.38)]"
        role="img"
        aria-label={`Analog clock showing ${label}`}
      >
        <defs>
          <linearGradient id={`${uid}-steel`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f6f8fa" />
            <stop offset="38%" stopColor="#c9d0d8" />
            <stop offset="62%" stopColor="#eef3f6" />
            <stop offset="100%" stopColor="#8ea0ab" />
          </linearGradient>
          <linearGradient id={`${uid}-index`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8b97a2" />
            <stop offset="30%" stopColor="#f5f7f9" />
            <stop offset="70%" stopColor="#c5ced6" />
            <stop offset="100%" stopColor="#6e7b86" />
          </linearGradient>
          <linearGradient id={`${uid}-hand-l`} x1="1" y1="0" x2="0" y2="0">
            <stop offset="0%" stopColor="#f4f7f8" />
            <stop offset="100%" stopColor="#8b9aa4" />
          </linearGradient>
          <linearGradient id={`${uid}-hand-r`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#e8eef1" />
            <stop offset="100%" stopColor="#b7c2c9" />
          </linearGradient>
          <radialGradient id={`${uid}-dial`} cx="48%" cy="42%" r="72%">
            <stop offset="0%" stopColor="#7fd0e4" />
            <stop offset="28%" stopColor="#2a9ec0" />
            <stop offset="62%" stopColor="#1678a4" />
            <stop offset="100%" stopColor="#0c4f78" />
          </radialGradient>
          <radialGradient id={`${uid}-sub`} cx="46%" cy="38%" r="70%">
            <stop offset="0%" stopColor="#f3f6f8" />
            <stop offset="100%" stopColor="#c2cdd4" />
          </radialGradient>
          <radialGradient id={`${uid}-glass`} cx="32%" cy="22%" r="55%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.28)" />
            <stop offset="45%" stopColor="rgba(255,255,255,0.06)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          <pattern id={`${uid}-waffle`} width="4.2" height="4.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4.2" height="4.2" fill="transparent" />
            <rect width="2" height="2" fill="rgba(255,255,255,0.09)" />
            <rect x="2.2" y="2.2" width="2" height="2" fill="rgba(0,20,40,0.1)" />
          </pattern>
          <clipPath id={`${uid}-dial-clip`}>
            <circle cx={CX} cy={CY} r={DIAL_R} />
          </clipPath>
          <mask id={`${uid}-hour-hole`}>
            <rect x="-14" y="-64" width="28" height="90" fill="white" />
            <circle cy="-14" r="3" fill="black" />
          </mask>
          <mask id={`${uid}-minute-hole`}>
            <rect x="-12" y="-90" width="24" height="116" fill="white" />
            <circle cy="-13" r="2.6" fill="black" />
          </mask>
        </defs>

        <circle cx={CX} cy={CY} r={109} fill={`url(#${uid}-steel)`} />
        <circle cx={CX} cy={CY} r={102.5} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.4" />
        <circle cx={CX} cy={CY} r={DIAL_R} fill={`url(#${uid}-dial)`} />

        <g clipPath={`url(#${uid}-dial-clip)`}>
          {Array.from({ length: 96 }, (_, i) => {
            const a = (i * Math.PI) / 48
            return (
              <line
                key={i}
                x1={CX}
                y1={CY}
                x2={CX + DIAL_R * Math.sin(a)}
                y2={CY - DIAL_R * Math.cos(a)}
                stroke="rgba(255,255,255,0.07)"
                strokeWidth={i % 4 === 0 ? 1.3 : 0.5}
              />
            )
          })}
          <circle cx={CX} cy={CY} r={DIAL_R} fill={`url(#${uid}-waffle)`} />
          <circle cx={CX} cy={CY} r={DIAL_R} fill={`url(#${uid}-glass)`} />
        </g>

        <circle cx={CX} cy={CY} r={DIAL_R - 0.7} fill="none" stroke="rgba(10,40,60,0.35)" strokeWidth="1.2" />

        {[0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11].map((hour) => (
          <HourIndex key={hour} hour={hour} uid={uid} />
        ))}

        <text
          x={CX}
          y={CY - 28}
          textAnchor="middle"
          fill="#f4f8fb"
          fontSize="11"
          fontWeight={650}
          letterSpacing="2"
          fontFamily="ui-serif, Georgia, serif"
        >
          SOURCEBOX
        </text>
        <text
          x={CX}
          y={CY - 16}
          textAnchor="middle"
          fill="rgba(244,248,251,0.72)"
          fontSize="5.4"
          fontWeight={600}
          letterSpacing="2.2"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          AUTOMATIC
        </text>

        <circle cx={SUB_X} cy={SUB_Y} r={SUB_R + 1.5} fill={`url(#${uid}-steel)`} />
        <circle cx={SUB_X} cy={SUB_Y} r={SUB_R} fill={`url(#${uid}-sub)`} />
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * Math.PI) / 6
          const inner = i % 3 === 0 ? SUB_R - 4.4 : SUB_R - 2.8
          return (
            <line
              key={i}
              x1={SUB_X + inner * Math.sin(a)}
              y1={SUB_Y - inner * Math.cos(a)}
              x2={SUB_X + (SUB_R - 1) * Math.sin(a)}
              y2={SUB_Y - (SUB_R - 0.9) * Math.cos(a)}
              stroke="#6d7c86"
              strokeWidth={i % 3 === 0 ? 1.25 : 0.65}
              strokeLinecap="round"
            />
          )
        })}

        <g ref={hourRef}>
          <g transform={`translate(${CX} ${CY})`} mask={`url(#${uid}-hour-hole)`}>
            <polygon points="0,14 4.6,-40 0,-58" fill={`url(#${uid}-hand-r)`} />
            <polygon points="0,14 -4.6,-40 0,-58" fill={`url(#${uid}-hand-l)`} />
          </g>
        </g>
        <g ref={minuteRef}>
          <g transform={`translate(${CX} ${CY})`} mask={`url(#${uid}-minute-hole)`}>
            <polygon points="0,16 3,-66 0,-84" fill={`url(#${uid}-hand-r)`} />
            <polygon points="0,16 -3,-66 0,-84" fill={`url(#${uid}-hand-l)`} />
          </g>
        </g>
        <g ref={secondRef}>
          <g transform={`translate(${SUB_X} ${SUB_Y})`}>
            <polygon points="0,8.2 0.7,8.2 0.35,-17.6 0,-19.4 -0.35,-17.6 -0.7,10.4" fill="#16384a" />
            <circle r="1.7" fill="#16384a" />
          </g>
        </g>

        <circle cx={CX} cy={CY} r="5.8" fill={`url(#${uid}-steel)`} />
        <circle cx={CX} cy={CY} r="2.15" fill="#2a4554" />
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
