/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#0E141F', // fondo base
          surface: '#161F30', // tarjetas
          raised: '#1C2740', // paneles elevados
          line: '#2A3550', // hairlines
        },
        parchment: {
          DEFAULT: '#E9EDF3', // texto principal
          muted: '#8A93A8', // texto secundario
          faint: '#5B6478',
        },
        seal: {
          DEFAULT: '#B8934A', // acento latón/sello
          bright: '#D4AE68',
          dim: '#8C6E38',
        },
        verified: {
          DEFAULT: '#4C9A6A', // confirmaciones
          bg: '#16261E',
        },
        alert: {
          DEFAULT: '#C4674B',
          bg: '#2A1C18',
        },
      },
      fontFamily: {
        display: ['"Source Serif 4"', 'Georgia', 'serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        seal: '0 0 0 1px rgba(184,147,74,0.25), 0 8px 24px -8px rgba(184,147,74,0.35)',
      },
      keyframes: {
        stamp: {
          '0%': { transform: 'scale(1.4) rotate(-8deg)', opacity: '0' },
          '55%': { transform: 'scale(0.94) rotate(2deg)', opacity: '1' },
          '75%': { transform: 'scale(1.04) rotate(-1deg)' },
          '100%': { transform: 'scale(1) rotate(0deg)', opacity: '1' },
        },
        rise: {
          '0%': { transform: 'translateY(6px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        stamp: 'stamp 480ms cubic-bezier(.2,.8,.2,1) forwards',
        rise: 'rise 320ms ease-out forwards',
      },
    },
  },
  plugins: [],
}
