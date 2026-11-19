type SealProps = { state: 'idle' | 'working' | 'stamped' }

// Sello notarial: gira y escanea mientras trabaja, se estampa con ondas de choque al firmar.
export default function Seal({ state }: SealProps) {
  const on = state === 'stamped'
  const c = on ? '#B8934A' : '#2A3550'
  return (
    <div className="relative h-16 w-16 shrink-0 select-none" data-seal aria-hidden="true">
      {on && <><span className="seal-ring" /><span className="seal-ring seal-ring-2" /></>}
      <div className={['h-full w-full', on ? 'animate-stamp seal-glow' : ''].join(' ')}>
        <svg viewBox="0 0 100 100" className="h-full w-full">
          <circle cx="50" cy="50" r="46" fill="none" stroke={c} strokeWidth="2" className="transition-colors duration-500" />
          {state === 'working' && (
            <circle cx="50" cy="50" r="46" fill="none" stroke="#D4AE68" strokeWidth="3" strokeLinecap="round" strokeDasharray="50 240" className="seal-spin" />
          )}
          <g className={state === 'working' ? 'seal-spin-rev' : ''}>
            <circle cx="50" cy="50" r="38" fill="none" stroke={c} strokeWidth="1" strokeDasharray="2 4" className="transition-colors duration-500" />
          </g>
          <path id="sealArc" d="M 50 12 A 38 38 0 1 1 49.9 12" fill="none" />
          <g className={state === 'working' ? 'seal-spin slow' : ''}>
            <text fontSize="7.5" fill={on ? '#D4AE68' : '#5B6478'} letterSpacing="2.5" className="transition-colors duration-500">
              <textPath href="#sealArc" startOffset="2%">SIGNSERVER · FIRMA VERIFICADA ·</textPath>
            </text>
          </g>
          <path
            d="M 30 52 L 44 66 L 72 34" fill="none" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" pathLength={1}
            stroke={on ? '#4C9A6A' : state === 'working' ? '#8A93A8' : '#3A4258'}
            className={on ? 'seal-check' : state === 'working' ? 'seal-check-loop' : 'transition-colors duration-500'}
          />
        </svg>
      </div>
    </div>
  )
}