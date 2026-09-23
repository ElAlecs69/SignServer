/// <reference types="vite/client" />

// jsPDF se carga desde CDN (ver index.html) y se expone como global.
interface Window {
  jspdf: {
    jsPDF: new (options?: Record<string, unknown>) => {
      internal: { pageSize: { getWidth: () => number; getHeight: () => number } }
      setFont: (font: string, style?: string) => void
      setFontSize: (size: number) => void
      setLineWidth: (width: number) => void
      line: (x1: number, y1: number, x2: number, y2: number) => void
      text: (text: string | string[], x: number, y: number, options?: Record<string, unknown>) => void
      splitTextToSize: (text: string, maxWidth: number) => string[]
      addPage: () => void
      output: (type?: string) => any
      save: (filename: string) => void
      [key: string]: any
    }
  }
}