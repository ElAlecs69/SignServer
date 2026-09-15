import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build de producción: genera /dist listo para copiar al volumen nginx_html.
// El proxy /signserver/* lo resuelve nginx (ver deploy/signserver.conf),
// así que en dev usamos el mismo prefijo apuntando al backend real.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://localhost',
        changeOrigin: true,
        secure: false,
      },
      '/auth': {
        target: 'https://localhost',
        changeOrigin: true,
        secure: false,
      },
      '/validate': {
        target: 'http://172.18.117.229:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/validate/, ''),
      },
      '/signserver': {
        target: 'https://172.18.117.229',
        changeOrigin: true,
        secure: false, // certificado autofirmado en desarrollo
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
})
