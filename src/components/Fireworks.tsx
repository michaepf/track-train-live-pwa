import { useMemo, type CSSProperties } from 'react'

const FIREWORK_COLORS = [
  '#4CAF50', '#8BC34A', '#CDDC39', '#FFC107',
  '#FF9800', '#FF5722', '#E91E63', '#9C27B0',
  '#3F51B5', '#03A9F4', '#00BCD4', '#F44336',
]

type Particle = {
  dx: number; dy: number
  size: number; color: string
  delay: number; duration: number
  burst: number
}

const BURST_OFFSETS = [
  { x: 0,   y: -20 },
  { x: -30, y: 10 },
  { x: 30,  y: 10 },
]

function generateParticles(): Particle[] {
  const particles: Particle[] = []
  BURST_OFFSETS.forEach((_, burst) => {
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2 + (Math.random() - 0.5) * 0.4
      const dist = 50 + Math.random() * 70
      particles.push({
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist,
        size: 5 + Math.random() * 5,
        color: FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)],
        delay: burst * 0.15 + Math.random() * 0.1,
        duration: 0.6 + Math.random() * 0.3,
        burst,
      })
    }
  })
  return particles
}

export default function Fireworks() {
  const particles = useMemo(generateParticles, [])
  return (
    <div className="fireworks-overlay" aria-hidden="true">
      {BURST_OFFSETS.map((offset, b) => (
        <div
          key={b}
          className="fireworks-burst"
          style={{ '--bx': `${offset.x}px`, '--by': `${offset.y}px` } as CSSProperties}
        >
          {particles
            .filter((p) => p.burst === b)
            .map((p, i) => (
              <div
                key={i}
                className="fireworks-particle"
                style={{
                  '--dx': `${p.dx}px`,
                  '--dy': `${p.dy}px`,
                  width: p.size,
                  height: p.size,
                  background: p.color,
                  animationDelay: `${p.delay}s`,
                  animationDuration: `${p.duration}s`,
                } as CSSProperties}
              />
            ))}
        </div>
      ))}
    </div>
  )
}
