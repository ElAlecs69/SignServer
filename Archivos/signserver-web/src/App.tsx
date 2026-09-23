import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import Seal from './Seal'

type User = { id: string; email: string; name: string; role: 'admin' | 'signer' | 'auditor' }
type Assignment = { id: string; name: string; status: string; sha256: string }
type Audit = { id: string; action: string; ip: string; details: string; created_at: string }

type WorkerOption = {
  id: string
  label: string
  desc: string
  ext: string[]
  validatePath: string
  /** Si true, este worker sólo valida — no puede usarse para firmar */
  validatorOnly?: boolean
}

/** Workers que realizan firma de documentos */
const SIGNER_WORKERS: WorkerOption[] = [
  {
    id: 'PDFSigner',
    label: 'PDF',
    desc: 'Firma documentos PDF con sello de tiempo embebido.',
    ext: ['.pdf'],
    validatePath: '/validate/pdf',
  },
  {
    id: 'CMSSigner',
    label: 'CMS / PKCS#7',
    desc: 'Firma archivos genéricos empaquetados en formato PKCS#7.',
    ext: ['.p7s', '.bin'],
    validatePath: '/validate/cms',
  },
  {
    id: 'XMLSigner',
    label: 'XML (XAdES)',
    desc: 'Firma archivos XML con estándar estructurado XAdES.',
    ext: ['.xml'],
    validatePath: '/validate/xml',
  },
  {
    id: 'JArchiveSigner',
    label: 'JAR / Java',
    desc: 'Firma paquetes JAR ejecutables y bibliotecas de Java.',
    ext: ['.jar'],
    validatePath: '/validate/jar',
  },
  {
    id: 'DebianDpkgSigSigner',
    label: 'Debian (.deb)',
    desc: 'Firma paquetes de distribución Debian.',
    ext: ['.deb'],
    validatePath: '/validate/deb',
  },
  {
    id: 'TimeStampSigner',
    label: 'Sello de tiempo (.tsq)',
    desc: 'Genera un token de sello de tiempo RFC 3161 para archivos TSQ.',
    ext: ['.tsq'],
    validatePath: '',
  },
  {
    id: 'MRTDSigner',
    label: 'MRTD (chip de pasaporte)',
    desc: 'Firma datos de chip de documento de viaje legible por máquina (MRTD).',
    ext: [],
    validatePath: '',
  },
  {
    id: 'MRTDSODSigner',
    label: 'MRTD SOD',
    desc: 'Firma la estructura SOD de un documento MRTD (pasaporte electrónico).',
    ext: [],
    validatePath: '',
  },
]

/** Workers que solo validan — no firman */
const VALIDATOR_WORKERS: WorkerOption[] = [
  {
    id: 'CRLValidator',
    label: 'Validador CRL (.der / .cer)',
    desc: 'Verifica un certificado contra la Lista de Revocación de Certificados (CRL) configurada en el servidor.',
    ext: ['.der', '.cer'],
    validatePath: '/validate/crl',
    validatorOnly: true,
  },
]

/** Lista unificada para búsquedas por id */
const WORKERS: WorkerOption[] = [...SIGNER_WORKERS, ...VALIDATOR_WORKERS]

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(path, { ...init, credentials: 'include' })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)
  return response.json()
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function timeStamp(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [csrf, setCsrf] = useState('')
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [audit, setAudit] = useState<Audit[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [signerEmail, setSignerEmail] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [loginEmail, setLoginEmail] = useState('admin@demo.test')
  const [loginPassword, setLoginPassword] = useState('demo123')

  // Vista activa: 'assigned' (flujo documental institucional) o 'direct' (pantalla original de firma/validación directa)
  const [view, setView] = useState<'assigned' | 'direct'>('direct')

  // Estados de la vista directa
  const [directMode, setDirectMode] = useState<'sign' | 'validate'>('sign')
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>('PDFSigner')
  const [directFile, setDirectFile] = useState<File | null>(null)
  const [signedResult, setSignedResult] = useState<{ name: string; base64: string } | null>(null)
  const [validateResult, setValidateResult] = useState<{ valid: boolean; summary: string; details: string } | null>(null)
  const [sealState, setSealState] = useState<'idle' | 'working' | 'stamped'>('idle')
  const [directBusy, setDirectBusy] = useState(false)

  // Campos del diseñador de PDF
  const [pdfDesign, setPdfDesign] = useState({
    titulo: '',
    autor: '',
    fecha: new Date().toISOString().slice(0, 10),
    cuerpo: '',
    piePagina: 'SignServer CE · Infraestructura de Firma Digital Segura',
  })
  const [logs, setLogs] = useState<string[]>([
    `${timeStamp()} Listo. Selecciona o arrastra un documento.`,
  ])

  const directFileInputRef = useRef<HTMLInputElement | null>(null)
  const logTerminalRef = useRef<HTMLDivElement | null>(null)

  function addLog(msg: string) {
    setLogs((prev) => [...prev, `${timeStamp()} ${msg}`])
  }

  useEffect(() => {
    if (logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight
    }
  }, [logs])

  async function refresh(currentUser: User) {
    try {
      const token = await api('/api/csrf')
      setCsrf(token.token)
      setAssignments(await api('/api/assignments'))
      if (currentUser.role === 'admin') setUsers(await api('/api/users'))
      if (currentUser.role === 'admin' || currentUser.role === 'auditor') setAudit(await api('/api/audit'))
    } catch {
      // Ignorar errores no críticos de polling
    }
  }

  useEffect(() => {
    api('/api/me')
      .then((currentUser: User) => {
        setUser(currentUser)
        return refresh(currentUser)
      })
      .catch(() => undefined)
  }, [])

  async function uploadAndAssign(event: FormEvent) {
    event.preventDefault()
    if (!file || !signerEmail) return
    setBusy(true)
    setMessage('')
    try {
      const form = new FormData()
      form.append('file', file)
      const document = await api('/api/documents', { method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: form })
      await api(`/api/documents/${document.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ signer_email: signerEmail }),
      })
      setFile(null)
      setMessage('Documento asignado correctamente.')
      if (user) await refresh(user)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  async function sign(assignmentId: string) {
    setBusy(true)
    try {
      await api(`/api/assignments/${assignmentId}/sign`, { method: 'POST', headers: { 'X-CSRF-Token': csrf } })
      setMessage('Documento firmado y registrado.')
      if (user) await refresh(user)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  // Manejo de archivo en modo directo
  function handleSelectDirectFile(f: File | null) {
    if (!f) return
    setDirectFile(f)
    setSignedResult(null)
    setValidateResult(null)
    setSealState('idle')
    addLog(`Archivo listo: ${f.name} (${formatSize(f.size)})`)
    // Detectar worker adecuado automáticamente si coincide la extensión
    const lower = f.name.toLowerCase()
    const matched = WORKERS.find((w) => w.ext.some((ext) => lower.endsWith(ext)))
    if (matched && matched.id !== selectedWorkerId) {
      setSelectedWorkerId(matched.id)
      addLog(`Worker sugerido por extensión: ${matched.id}`)
    }
  }

  // Construye un documento jsPDF a partir de los campos del diseñador
  function buildDesignedPdf() {
    // @ts-ignore
    const jsPDFClass = window.jspdf?.jsPDF || (window as any).jsPDF
    if (!jsPDFClass) {
      throw new Error('Librería jsPDF no encontrada en la página.')
    }
    const doc = new jsPDFClass()
    const marginX = 20
    let cursorY = 28

    doc.setFontSize(20)
    doc.text(pdfDesign.titulo || 'Documento sin título', marginX, cursorY)
    cursorY += 12

    doc.setLineWidth(0.5)
    doc.line(marginX, cursorY, 190, cursorY)
    cursorY += 12

    doc.setFontSize(11)
    if (pdfDesign.autor) {
      doc.text(`Autor: ${pdfDesign.autor}`, marginX, cursorY)
      cursorY += 8
    }
    if (pdfDesign.fecha) {
      doc.text(`Fecha: ${pdfDesign.fecha}`, marginX, cursorY)
      cursorY += 8
    }
    if (pdfDesign.autor || pdfDesign.fecha) cursorY += 4

    doc.setFontSize(11)
    const bodyLines: string[] = doc.splitTextToSize(pdfDesign.cuerpo || '', 170)
    doc.text(bodyLines, marginX, cursorY)
    cursorY += bodyLines.length * 6 + 12

    if (pdfDesign.piePagina) {
      doc.setLineWidth(0.3)
      doc.line(marginX, 280, 190, 280)
      doc.setFontSize(9)
      doc.text(pdfDesign.piePagina, marginX, 287)
    }

    return doc
  }

  // Genera el PDF diseñado y lo carga como archivo listo para firmar
  function handleUsePdfForSigning() {
    try {
      const doc = buildDesignedPdf()
      const blob = doc.output('blob')
      const fileName = `${(pdfDesign.titulo || 'documento').trim().slice(0, 60) || 'documento'}.pdf`
      const designedFile = new File([blob], fileName, { type: 'application/pdf' })
      handleSelectDirectFile(designedFile)
      addLog('PDF diseñado generado y listo para firmar.')
    } catch (err) {
      addLog(`Error generando PDF: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Genera el PDF diseñado y lo descarga directamente al equipo
  function handleDownloadDesignedPdf() {
    try {
      const doc = buildDesignedPdf()
      const fileName = `${(pdfDesign.titulo || 'documento').trim().slice(0, 60) || 'documento'}.pdf`
      doc.save(fileName)
      addLog('PDF diseñado descargado correctamente.')
    } catch (err) {
      addLog(`Error generando PDF: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Convertir a base64
  function fileToBase64(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const res = reader.result as string
        const base64 = res.split(',')[1] || res
        resolve(base64)
      }
      reader.onerror = reject
      reader.readAsDataURL(f)
    })
  }

  // Descargar archivo base64
  function downloadSignedFile() {
    if (!signedResult) return
    const binary = atob(signedResult.base64)
    const len = binary.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    const blob = new Blob([bytes], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = signedResult.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Ejecutar firma directa
  async function handleDirectSign() {
    if (!directFile) return
    setDirectBusy(true)
    setSealState('working')
    setSignedResult(null)
    setValidateResult(null)
    addLog(`Worker: ${selectedWorkerId}`)
    addLog('Leyendo y codificando archivo...')

    try {
      const b64 = await fileToBase64(directFile)
      addLog(`Enviando a /signserver/rest/v1/workers/${selectedWorkerId}/process`)
      const res = await fetch(`/signserver/rest/v1/workers/${selectedWorkerId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: b64, encoding: 'BASE64' }),
      })

      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(`HTTP ${res.status}: ${errorText.slice(0, 180)}`)
      }

      const json = await res.json()
      const signedBase64 = json.data
      const signedName = directFile.name.replace(/(\.[^.]+)$/, '-firmado$1')
      setSignedResult({ name: signedName, base64: signedBase64 })
      setSealState('stamped')
      addLog(`Listo. Descarga disponible: ${signedName}`)
    } catch (err) {
      setSealState('idle')
      addLog(`Error al firmar: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDirectBusy(false)
    }
  }

  // Ejecutar validación directa
  async function handleDirectValidate() {
    if (!directFile) return
    setDirectBusy(true)
    setSealState('working')
    setValidateResult(null)
    setSignedResult(null)
    const worker = WORKERS.find((w) => w.id === selectedWorkerId) || WORKERS[0]
    addLog(`Validando archivo con endpoint ${worker.validatePath}...`)

    try {
      const b64 = await fileToBase64(directFile)
      const res = await fetch(worker.validatePath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: b64, filename: directFile.name, encoding: 'BASE64' }),
      })

      if (!res.ok) {
        const errTxt = await res.text()
        throw new Error(`HTTP ${res.status}: ${errTxt.slice(0, 180)}`)
      }

      const data = await res.json()
      setValidateResult({ valid: data.valid, summary: data.summary, details: data.details })
      setSealState(data.valid ? 'stamped' : 'idle')
      addLog(`Resultado: ${data.valid ? 'FIRMA VÁLIDA' : 'FIRMA NO VÁLIDA'} - ${data.summary}`)
    } catch (err) {
      setSealState('idle')
      addLog(`Error en validación: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDirectBusy(false)
    }
  }

  const currentWorker = WORKERS.find((w) => w.id === selectedWorkerId) || WORKERS[0]

  if (!user) {
    return (
      <main className="min-h-screen bg-ink flex items-center justify-center p-6">
        <section className="w-full max-w-lg rounded-2xl border border-ink-line bg-ink-surface p-10 text-center">
          <div className="flex justify-center mb-4">
            <Seal state="idle" />
          </div>
          <h1 className="font-display text-3xl text-parchment">SignServer</h1>
          <p className="mt-3 text-parchment-muted">Login de pruebas · firma y trazabilidad documental</p>
          <form method="get" action="/auth/login" className="mt-8 grid gap-3 text-left">
            <label className="grid gap-2 text-sm text-parchment-muted">
              <span>Correo</span>
              <input
                name="email"
                type="email"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                required
                className="rounded-lg border border-ink-line bg-ink-raised px-3 py-3 text-parchment"
                placeholder="correo@example.com"
              />
            </label>
            <label className="grid gap-2 text-sm text-parchment-muted">
              <span>Contraseña</span>
              <input
                name="password"
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                required
                className="rounded-lg border border-ink-line bg-ink-raised px-3 py-3 text-parchment"
                placeholder="Contraseña de prueba"
              />
            </label>
            <button type="submit" className="mt-2 rounded-lg bg-seal px-5 py-3 font-medium text-ink">
              Entrar
            </button>
          </form>
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-ink px-6 py-8 text-parchment">
      <div className="mx-auto max-w-6xl">
        {/* Encabezado principal */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-ink-line pb-6">
          <div className="flex items-center gap-4">
            <Seal state={view === 'direct' ? sealState : 'idle'} />
            <div>
              <h1 className="font-display text-3xl">Registro de Firmas</h1>
              <p className="mt-1 font-mono text-xs uppercase tracking-wider text-parchment-muted">
                SIGNSERVER CE · USO INTERNO
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Indicador de servicio activo */}
            <div className="flex items-center gap-2 rounded-full border border-verified/30 bg-verified-bg px-3 py-1 text-xs text-verified">
              <span className="inline-block h-2 w-2 rounded-full bg-verified animate-pulse" />
              <span>servicio activo</span>
            </div>

            {/* Selector de pantalla */}
            {view === 'direct' ? (
              <button
                onClick={() => setView('assigned')}
                className="rounded-lg border border-ink-line px-4 py-2 text-sm text-parchment-muted hover:border-parchment-muted hover:text-parchment transition-colors"
              >
                Ver asignaciones y auditoría
              </button>
            ) : (
              <button
                onClick={() => setView('direct')}
                className="rounded-lg bg-seal px-4 py-2 text-sm font-medium text-ink transition-opacity hover:opacity-90"
              >
                Firma directa y validación
              </button>
            )}

            <button
              onClick={() => api('/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrf } }).then(() => location.reload())}
              className="rounded-lg border border-ink-line px-4 py-2 text-sm text-parchment-muted hover:text-parchment transition-colors"
            >
              Cerrar sesión
            </button>
          </div>
        </header>

        {/* ============================================================ */}
        {/* VISTA 1: FIRMA DIRECTA, CREACIÓN DE PDF, VALIDACIÓN Y BITÁCORA */}
        {/* ============================================================ */}
        {view === 'direct' && (
          <div className="mt-8 grid gap-8 lg:grid-cols-2">
            {/* Columna Izquierda: Firma / Validación */}
            <section className="rounded-2xl border border-ink-line bg-ink-surface p-7 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-2xl">
                    {directMode === 'sign' ? 'Firmar un documento' : 'Validar un documento'}
                  </h2>
                  <p className="mt-1 text-sm text-parchment-muted">
                    {directMode === 'sign'
                      ? 'Arrastra un archivo, elige el worker correspondiente y firma en un clic.'
                      : 'Sube un archivo firmado para verificar su integridad y firma digital.'}
                  </p>
                </div>

                {/* Alternador de Modo: Firmar / Validar */}
                <div className="inline-flex rounded-lg border border-ink-line bg-ink p-1 text-xs">
                  <button
                    onClick={() => {
                      setDirectMode('sign')
                      setSignedResult(null)
                      setValidateResult(null)
                    }}
                    className={`rounded-md px-3 py-1 font-medium transition-colors ${
                      directMode === 'sign' ? 'bg-seal text-ink' : 'text-parchment-muted hover:text-parchment'
                    }`}
                  >
                    Firmar
                  </button>
                  <button
                    onClick={() => {
                      setDirectMode('validate')
                      setSignedResult(null)
                      setValidateResult(null)
                    }}
                    className={`rounded-md px-3 py-1 font-medium transition-colors ${
                      directMode === 'validate' ? 'bg-verified text-parchment' : 'text-parchment-muted hover:text-parchment'
                    }`}
                  >
                    Validar
                  </button>
                </div>
              </div>

              {/* Zona de Arrastrar / Cargar Archivo */}
              <div
                onClick={() => directFileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  if (e.dataTransfer.files?.[0]) {
                    handleSelectDirectFile(e.dataTransfer.files[0])
                  }
                }}
                className="mt-6 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-ink-line bg-ink-raised/60 p-8 text-center cursor-pointer transition-colors hover:border-seal/60"
              >
                <input
                  ref={directFileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      handleSelectDirectFile(e.target.files[0])
                    }
                  }}
                />

                {directFile ? (
                  <div>
                    <span className="font-mono text-xs font-semibold uppercase tracking-wider text-seal">
                      ARCHIVO LISTO
                    </span>
                    <p className="mt-2 text-base font-medium text-parchment">{directFile.name}</p>
                    <p className="mt-1 font-mono text-xs text-parchment-muted">
                      Tamaño: {formatSize(directFile.size)}
                    </p>
                    <p className="mt-3 text-xs text-parchment-faint underline">Haz clic para cambiar archivo</p>
                  </div>
                ) : (
                  <div>
                    <svg className="mx-auto h-10 w-10 text-parchment-muted/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="mt-3 text-sm text-parchment">
                      Arrastra un archivo aquí o <span className="text-seal underline">selecciónalo</span>
                    </p>
                    <p className="mt-1 font-mono text-xs text-parchment-faint">PDF, XML, CMS/PKCS#7, JAR, DEB</p>
                  </div>
                )}
              </div>

              <div className="mt-3 flex items-center justify-end">
                {directFile && (
                  <button
                    type="button"
                    onClick={() => {
                      setDirectFile(null)
                      setSignedResult(null)
                      setValidateResult(null)
                      setSealState('idle')
                      addLog('Archivo removido.')
                    }}
                    className="text-xs text-alert hover:underline"
                  >
                    Quitar archivo
                  </button>
                )}
              </div>

              {/* Selector de Worker */}
              <div className="mt-6">
                <label className="block text-xs font-semibold uppercase tracking-wider text-parchment-muted">
                  WORKER / VALIDADOR
                </label>
                <select
                  value={selectedWorkerId}
                  onChange={(e) => {
                    setSelectedWorkerId(e.target.value)
                    addLog(`Worker cambiado a: ${e.target.value}`)
                    // Si el worker seleccionado es solo validador, forzar modo validar
                    const chosen = WORKERS.find((w) => w.id === e.target.value)
                    if (chosen?.validatorOnly) {
                      setDirectMode('validate')
                      setSignedResult(null)
                    }
                  }}
                  className="mt-2 w-full rounded-lg border border-ink-line bg-ink-raised px-4 py-3 text-parchment outline-none focus:border-seal"
                >
                  <optgroup label="── Firmadores ──────────────────">
                    {SIGNER_WORKERS.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="── Validadores ─────────────────">
                    {VALIDATOR_WORKERS.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.label}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <p className="mt-2 text-xs text-parchment-muted">{currentWorker.desc}</p>
                {currentWorker.validatorOnly && (
                  <p className="mt-1 text-xs font-medium text-alert">
                    Este worker sólo valida — el modo firma está deshabilitado.
                  </p>
                )}
              </div>

              {/* Botón de Acción Principal */}
              <div className="mt-6">
                {directMode === 'sign' ? (
                  <button
                    disabled={!directFile || directBusy || currentWorker.validatorOnly}
                    onClick={handleDirectSign}
                    className="w-full rounded-xl bg-seal py-3.5 font-medium text-ink transition-opacity hover:opacity-95 disabled:opacity-50"
                  >
                    {directBusy ? 'Firmando documento...' : 'Firmar documento'}
                  </button>
                ) : (
                  <button
                    disabled={!directFile || directBusy}
                    onClick={handleDirectValidate}
                    className="w-full rounded-xl bg-verified py-3.5 font-medium text-parchment transition-opacity hover:opacity-95 disabled:opacity-50"
                  >
                    {directBusy ? 'Validando...' : 'Validar documento'}
                  </button>
                )}
              </div>

              {/* Resultado de Firma: Barra con botón Descargar */}
              {signedResult && (
                <div className="mt-5 flex items-center justify-between rounded-xl border border-verified/40 bg-verified-bg p-4 animate-rise">
                  <div className="flex items-center gap-2 text-sm font-medium text-verified">
                    <span>✓</span>
                    <span>Documento firmado</span>
                  </div>
                  <button
                    onClick={downloadSignedFile}
                    className="rounded-lg border border-verified bg-verified/20 px-4 py-2 text-sm font-medium text-verified transition-colors hover:bg-verified hover:text-ink"
                  >
                    Descargar
                  </button>
                </div>
              )}

              {/* Resultado de Validación */}
              {validateResult && (
                <div
                  className={`mt-5 rounded-xl border p-4 animate-rise ${
                    validateResult.valid
                      ? 'border-verified/40 bg-verified-bg text-verified'
                      : 'border-alert/40 bg-alert-bg text-alert'
                  }`}
                >
                  <div className="flex items-center justify-between font-medium">
                    <span>{validateResult.valid ? '✓ Firma Íntegra y Válida' : '✕ Firma No Válida'}</span>
                  </div>
                  <p className="mt-2 text-xs text-parchment">{validateResult.summary}</p>
                  {validateResult.details && (
                    <pre className="mt-3 max-h-32 overflow-auto rounded bg-ink/70 p-2 font-mono text-[11px] text-parchment-muted whitespace-pre-wrap">
                      {validateResult.details}
                    </pre>
                  )}
                </div>
              )}
            </section>

            {/* Columna Derecha: Bitácora de Sesión */}
            <section className="flex flex-col rounded-2xl border border-ink-line bg-ink-surface p-7 shadow-lg">
              <div className="flex items-center gap-3 border-b border-ink-line pb-4">
                <div className="h-8 w-8 text-seal">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <h2 className="font-display text-2xl">Bitácora</h2>
                  <p className="text-xs text-parchment-muted">actividad de esta sesión</p>
                </div>
              </div>

              {/* Terminal de Logs */}
              <div
                ref={logTerminalRef}
                className="mt-6 flex-1 min-h-[300px] max-h-[440px] overflow-y-auto rounded-xl border border-ink-line bg-ink p-4 font-mono text-xs text-verified/90 space-y-2 select-text"
              >
                {logs.map((item, idx) => (
                  <div key={idx} className="leading-relaxed">
                    {item}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ============================================================ */}
        {/* DISEÑADOR DE PDF: crear un documento desde cero y descargarlo */}
        {/* ============================================================ */}
        {view === 'direct' && (
          <section className="mt-8 rounded-2xl border border-ink-line bg-ink-surface p-7 shadow-lg">
            <h2 className="font-display text-2xl">Diseñar PDF</h2>
            <p className="mt-1 text-sm text-parchment-muted">
              Completa los campos para armar un documento PDF y descárgalo, o úsalo directamente para firmarlo arriba.
            </p>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-parchment-muted">
                  Título
                </label>
                <input
                  type="text"
                  value={pdfDesign.titulo}
                  onChange={(e) => setPdfDesign({ ...pdfDesign, titulo: e.target.value })}
                  placeholder="Título del documento"
                  className="mt-2 w-full rounded-lg border border-ink-line bg-ink-raised px-4 py-3 text-parchment outline-none focus:border-seal"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-parchment-muted">
                  Autor
                </label>
                <input
                  type="text"
                  value={pdfDesign.autor}
                  onChange={(e) => setPdfDesign({ ...pdfDesign, autor: e.target.value })}
                  placeholder="Nombre del autor o emisor"
                  className="mt-2 w-full rounded-lg border border-ink-line bg-ink-raised px-4 py-3 text-parchment outline-none focus:border-seal"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-parchment-muted">
                  Fecha
                </label>
                <input
                  type="date"
                  value={pdfDesign.fecha}
                  onChange={(e) => setPdfDesign({ ...pdfDesign, fecha: e.target.value })}
                  className="mt-2 w-full rounded-lg border border-ink-line bg-ink-raised px-4 py-3 text-parchment outline-none focus:border-seal"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-parchment-muted">
                  Pie de página
                </label>
                <input
                  type="text"
                  value={pdfDesign.piePagina}
                  onChange={(e) => setPdfDesign({ ...pdfDesign, piePagina: e.target.value })}
                  placeholder="Texto de pie de página (opcional)"
                  className="mt-2 w-full rounded-lg border border-ink-line bg-ink-raised px-4 py-3 text-parchment outline-none focus:border-seal"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-parchment-muted">
                  Contenido
                </label>
                <textarea
                  value={pdfDesign.cuerpo}
                  onChange={(e) => setPdfDesign({ ...pdfDesign, cuerpo: e.target.value })}
                  placeholder="Escribe aquí el cuerpo del documento..."
                  rows={6}
                  className="mt-2 w-full resize-y rounded-lg border border-ink-line bg-ink-raised px-4 py-3 text-parchment outline-none focus:border-seal"
                />
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleDownloadDesignedPdf}
                className="rounded-xl bg-seal px-6 py-3 font-medium text-ink transition-opacity hover:opacity-95"
              >
                Descargar PDF
              </button>
              <button
                type="button"
                onClick={handleUsePdfForSigning}
                className="rounded-xl border border-ink-line px-6 py-3 font-medium text-parchment transition-colors hover:border-seal/60"
              >
                Usar para firmar
              </button>
            </div>
          </section>
        )}

        {/* ============================================================ */}
        {/* VISTA 2: FLUJO DE DOCUMENTOS ASIGNADOS Y AUDITORÍA GENERAL */}
        {/* ============================================================ */}
        {view === 'assigned' && (
          <div>
            {message && (
              <p className="my-5 rounded-lg border border-seal/40 bg-seal/10 p-3 text-sm" role="status">
                {message}
              </p>
            )}

            {user.role === 'admin' && (
              <section className="mt-8 rounded-2xl border border-ink-line bg-ink-surface p-6 shadow-lg">
                <h2 className="font-display text-2xl">Asignar documento</h2>
                <form onSubmit={uploadAndAssign} className="mt-5 grid gap-4 md:grid-cols-[1fr_1fr_auto]">
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                    className="rounded-lg border border-ink-line bg-ink-raised p-3 text-sm"
                    required
                  />
                  <select
                    value={signerEmail}
                    onChange={(event) => setSignerEmail(event.target.value)}
                    className="rounded-lg border border-ink-line bg-ink-raised p-3"
                    required
                  >
                    <option value="">Selecciona firmante</option>
                    {users.map((item) => (
                      <option key={item.id} value={item.email}>
                        {item.name || item.email}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={busy}
                    className="rounded-lg bg-seal px-6 py-3 font-medium text-ink disabled:opacity-50"
                  >
                    Subir y asignar
                  </button>
                </form>
              </section>
            )}

            <section className="mt-8 rounded-2xl border border-ink-line bg-ink-surface p-6 shadow-lg">
              <h2 className="font-display text-2xl">
                {user.role === 'signer' ? 'Mis documentos' : 'Documentos asignados'}
              </h2>
              <div className="mt-5 divide-y divide-ink-line">
                {assignments.length === 0 ? (
                  <p className="py-5 text-sm text-parchment-muted">No hay documentos asignados.</p>
                ) : (
                  assignments.map((item) => (
                    <div key={item.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                      <div>
                        <p>{item.name}</p>
                        <p className="mt-1 font-mono text-xs text-parchment-faint">SHA-256: {item.sha256}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-parchment-muted">{item.status}</span>
                        {user.role === 'signer' && item.status === 'pending' && (
                          <button
                            disabled={busy}
                            onClick={() => sign(item.id)}
                            className="rounded-lg bg-seal px-4 py-2 text-sm text-ink"
                          >
                            Firmar
                          </button>
                        )}
                        {item.status === 'signed' && (
                          <a
                            href={`/api/assignments/${item.id}/download`}
                            className="rounded-lg border border-verified/50 px-4 py-2 text-sm text-verified"
                          >
                            Descargar
                          </a>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            {(user.role === 'admin' || user.role === 'auditor') && (
              <section className="mt-8 rounded-2xl border border-ink-line bg-ink-surface p-6 shadow-lg">
                <h2 className="font-display text-2xl">Auditoría</h2>
                <div className="mt-5 overflow-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-parchment-muted">
                      <tr>
                        <th className="p-2">Fecha</th>
                        <th className="p-2">Evento</th>
                        <th className="p-2">IP</th>
                        <th className="p-2">Detalle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.map((item) => (
                        <tr key={item.id} className="border-t border-ink-line">
                          <td className="p-2 whitespace-nowrap">{new Date(item.created_at).toLocaleString()}</td>
                          <td className="p-2">{item.action}</td>
                          <td className="p-2">{item.ip}</td>
                          <td className="p-2">{item.details}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}

        {/* Pie de página idéntico al diseño */}
        <footer className="mt-12 border-t border-ink-line/50 pt-6 text-center text-xs font-mono text-parchment-faint">
          SignServer CE · proxy nginx · firma digital interna
        </footer>
      </div>
    </main>
  )
}