import type { ReactNode } from 'react'

/**
 * Infinite logo strip for the login brand panel. Names and marks are invented — they are
 * decoration, not real companies, and the track is hidden from assistive tech.
 */

type Logo = {
  name: string
  color: string
  mark: ReactNode
}

function Pictogram({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 48 48" className="h-10 w-10" aria-hidden="true">
      {children}
    </svg>
  )
}

const LOGOS: Logo[] = [
  {
    name: 'Northwind Labs',
    color: '#FFE08A',
    mark: (
      <Pictogram>
        <circle cx="24" cy="24" r="22" fill="#F4A261" />
        <circle cx="24" cy="24" r="18" fill="#E76F51" />
        <path d="M24 6 L28 24 L24 24 Z" fill="#FFF6D6" />
        <path d="M24 6 L20 24 L24 24 Z" fill="#FFB703" />
        <path d="M42 24 L24 28 L24 24 Z" fill="#FFF6D6" />
        <path d="M42 24 L24 20 L24 24 Z" fill="#FFB703" />
        <path d="M24 42 L20 24 L24 24 Z" fill="#FFF6D6" />
        <path d="M24 42 L28 24 L24 24 Z" fill="#C1121F" />
        <path d="M6 24 L24 20 L24 24 Z" fill="#FFF6D6" />
        <path d="M6 24 L24 28 L24 24 Z" fill="#C1121F" />
        <circle cx="24" cy="24" r="4.5" fill="#FFF6D6" />
        <circle cx="24" cy="24" r="2" fill="#E76F51" />
      </Pictogram>
    ),
  },
  {
    name: 'Helix & Co',
    color: '#9EF0E0',
    mark: (
      <Pictogram>
        <rect width="48" height="48" rx="14" fill="#1D6A6E" />
        <path
          d="M16 8 C28 8 20 24 32 24 C20 24 28 40 16 40"
          fill="none"
          stroke="#7FDBDA"
          strokeWidth="3.4"
          strokeLinecap="round"
        />
        <path
          d="M32 8 C12 12 20 24 16 24 C30 24 16 38 32 40"
          fill="none"
          stroke="#F4A261"
          strokeWidth="3.4"
          strokeLinecap="round"
        />
        <circle cx="16" cy="8" r="2.4" fill="#FFE08A" />
        <circle cx="32" cy="40" r="2.4" fill="#FFE08A" />
      </Pictogram>
    ),
  },
  {
    name: 'Copperline',
    color: '#FFC48A',
    mark: (
      <Pictogram>
        <rect width="48" height="48" rx="14" fill="#9C2F12" />
        <rect x="9" y="10" width="30" height="8" rx="2" fill="#E76F51" />
        <rect x="9" y="20" width="24" height="8" rx="2" fill="#F4A261" />
        <rect x="9" y="30" width="28" height="8" rx="2" fill="#FFE0C2" />
        <circle cx="35" cy="14" r="2" fill="#FFF3E0" />
      </Pictogram>
    ),
  },
  {
    name: 'Vesper Grid',
    color: '#C9F0A8',
    mark: (
      <Pictogram>
        <rect width="48" height="48" rx="14" fill="#1B4332" />
        <rect x="8" y="8" width="14" height="14" rx="3" fill="#B5E48C" />
        <rect x="26" y="8" width="14" height="14" rx="3" fill="#52B69A" />
        <rect x="8" y="26" width="14" height="14" rx="3" fill="#76C893" />
        <rect x="26" y="26" width="14" height="14" rx="3" fill="#D9ED92" />
      </Pictogram>
    ),
  },
  {
    name: 'Lumenfold',
    color: '#F8E7A0',
    mark: (
      <Pictogram>
        <rect width="48" height="48" rx="14" fill="#3D2E08" />
        <path d="M24 6 L42 24 L24 42 L6 24 Z" fill="#F4D35E" />
        <path d="M24 6 L24 42 L42 24 Z" fill="#FFB703" />
        <path d="M24 16 L32 24 L24 32 L16 24 Z" fill="#FFF6D6" />
      </Pictogram>
    ),
  },
  {
    name: 'Oak Signal',
    color: '#F6D6A8',
    mark: (
      <Pictogram>
        <rect width="48" height="48" rx="14" fill="#2D6A4F" />
        <ellipse cx="24" cy="20" rx="13" ry="12" fill="#95D5B2" />
        <ellipse cx="16" cy="24" rx="8" ry="9" fill="#74C69D" />
        <ellipse cx="32" cy="24" rx="8" ry="9" fill="#D8F3DC" />
        <rect x="21" y="28" width="6" height="14" rx="1.5" fill="#D4A373" />
      </Pictogram>
    ),
  },
  {
    name: 'Fathom Peak',
    color: '#B8E0FF',
    mark: (
      <Pictogram>
        <rect width="48" height="48" rx="14" fill="#023E8A" />
        <circle cx="34" cy="14" r="6" fill="#FFE08A" />
        <path d="M4 40 L18 16 L26 28 L32 18 L44 40 Z" fill="#48CAE4" />
        <path d="M18 40 L24 26 L30 40 Z" fill="#CAF0F8" />
        <path d="M4 40 H44 V44 H4 Z" fill="#0077B6" />
      </Pictogram>
    ),
  },
  {
    name: 'Harborline',
    color: '#A8E6CF',
    mark: (
      <Pictogram>
        <rect width="48" height="48" rx="14" fill="#014F86" />
        <path d="M24 6 L28 22 H20 Z" fill="#FFE08A" />
        <rect x="22.5" y="22" width="3" height="10" fill="#E9ECEF" />
        <path d="M8 36 C14 30 20 38 24 34 C28 30 34 38 40 32 V42 H8 Z" fill="#80BEC7" />
        <path d="M8 40 C14 36 20 42 24 38 C28 34 34 42 40 36 V42 H8 Z" fill="#7FDBDA" />
      </Pictogram>
    ),
  },
  {
    name: 'Quillbeam',
    color: '#FFD6E0',
    mark: (
      <Pictogram>
        <rect width="48" height="48" rx="14" fill="#6D2E4B" />
        <path d="M12 40 L18 22 L40 8 L30 30 Z" fill="#F4A5AE" />
        <path d="M18 22 L30 30" fill="none" stroke="#FFF0F3" strokeWidth="1.6" />
        <path d="M12 40 L16 34 L20 38 Z" fill="#FFE08A" />
        <circle cx="38" cy="10" r="2.2" fill="#FFF6D6" />
      </Pictogram>
    ),
  },
  {
    name: 'Tandemforge',
    color: '#C5F0C0',
    mark: (
      <Pictogram>
        <rect width="48" height="48" rx="14" fill="#1B4332" />
        <circle cx="18" cy="24" r="12" fill="none" stroke="#80BEC7" strokeWidth="3.5" />
        <circle cx="30" cy="24" r="12" fill="none" stroke="#F4D35E" strokeWidth="3.5" />
        <circle cx="24" cy="24" r="4" fill="#D8F3DC" />
      </Pictogram>
    ),
  },
  {
    name: 'Paperkite',
    color: '#FFE4A8',
    mark: (
      <Pictogram>
        <rect width="48" height="48" rx="14" fill="#7B2D12" />
        <path d="M24 6 L40 22 L24 20 L8 22 Z" fill="#F77F00" />
        <path d="M24 6 L24 20 L40 22 Z" fill="#FFB703" />
        <path d="M24 20 L24 30" fill="none" stroke="#FFE08A" strokeWidth="2" />
        <path d="M24 30 L18 38 L24 34 L30 42" fill="none" stroke="#F4A261" strokeWidth="2" strokeLinecap="round" />
      </Pictogram>
    ),
  },
  {
    name: 'Rivermark',
    color: '#B8F2E6',
    mark: (
      <Pictogram>
        <rect width="48" height="48" rx="14" fill="#0A4D4A" />
        <path
          d="M8 34 C14 14 20 34 24 24 C28 14 34 34 40 14"
          fill="none"
          stroke="#7FDBDA"
          strokeWidth="3.6"
          strokeLinecap="round"
        />
        <path
          d="M10 40 C16 28 22 40 26 32"
          fill="none"
          stroke="#FFE08A"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <circle cx="40" cy="14" r="3" fill="#FFE08A" />
      </Pictogram>
    ),
  },
]

function LogoItem({ name, color, mark }: Logo) {
  return (
    <div className="flex items-center gap-3.5 px-10">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/25">
        {mark}
      </div>
      <span className="whitespace-nowrap text-[17px] font-bold tracking-tight" style={{ color }}>
        {name}
      </span>
    </div>
  )
}

export function LogoCarousel() {
  const loop = [...LOGOS, ...LOGOS]

  return (
    <div
      className="overflow-hidden py-4"
      style={{
        maskImage: 'linear-gradient(to right, transparent, black 7%, black 93%, transparent)',
        WebkitMaskImage: 'linear-gradient(to right, transparent, black 7%, black 93%, transparent)',
      }}
    >
      <p className="sr-only">Fictional partner logos</p>
      <div className="flex w-max animate-marquee hover:[animation-play-state:paused]" aria-hidden="true">
        {loop.map((logo, index) => (
          <LogoItem key={`${logo.name}-${index}`} {...logo} />
        ))}
      </div>
    </div>
  )
}
