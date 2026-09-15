/// <reference types="vite/client" />

// jsPDF se carga desde CDN (ver index.html) y se expone como global.
interface Window {
  jspdf: {
    jsPDF: new (options?: Record<string, unknown>) => {
      internal: { pageSize: { getWidth: () => number; getHeight: () => number } }
      setFont: (font: string, style?: string) => void
      setFontSize: (size: number) => void
      text: (text: string | string[], x: number, y: number, options?: Record<string, unknown>) => void
      splitTextToSize: (text: string, maxWidth: number) => string[]
      addPage: () => void
      save: (filename: string) => void
    }
  }
}