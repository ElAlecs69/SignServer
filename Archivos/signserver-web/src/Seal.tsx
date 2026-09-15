type SealProps = {
  state: 'idle' | 'working' | 'stamped'
}

// El sello es el elemento "signature" del diseño: una marca circular tipo
// timbre notarial que se estampa cuando el documento queda firmado.
export default function Seal({ state }: SealProps) {
  return (
    <div
      className={[
        'relative h-16 w-16 shrink-0 select-none',
        state === 'stamped' ? 'animate-stamp' : '',
      ].join(' ')}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 100" className="h-full w-full">
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke={state === 'stamped' ? '#B8934A' : '#2A3550'}
          strokeWidth="2"
          className="transition-colors duration-500"
        />
        <circle
          cx="50"
          cy="50"
          r="38"
          fill="none"
          stroke={state === 'stamped' ? '#B8934A' : '#2A3550'}
          strokeWidth="1"
          strokeDasharray="2 4"
          className="transition-colors duration-500"
        />
        <path
          id="sealArc"
          d="M 50 12 A 38 38 0 1 1 49.9 12"
          fill="none"
        />
        <text
          fontSize="7.5"
          fill={state === 'stamped' ? '#D4AE68' : '#5B6478'}
          letterSpacing="2.5"
          className="transition-colors duration-500"
        >
          <textPath href="#sealArc" startOffset="2%">
            SIGNSERVER · FIRMA VERIFICADA ·
          </textPath>
        </text>
        {state === 'working' ? (
          <path
            d="M 30 52 L 44 66 L 72 34"
            fill="none"
            stroke="#8A93A8"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="60"
            strokeDashoffset="60"
          >
            <animate
              attributeName="stroke-dashoffset"
              values="60;0;60"
              dur="1.4s"
              repeatCount="indefinite"
            />
          </path>
        ) : (
          <path
            d="M 30 52 L 44 66 L 72 34"
            fill="none"
            stroke={state === 'stamped' ? '#4C9A6A' : '#3A4258'}
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-colors duration-500"
          />
        )}
      </svg>
    </div>
  )
}
