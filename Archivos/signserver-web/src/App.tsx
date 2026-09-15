import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

type User = { id: string; email: string; name: string; role: 'admin' | 'signer' | 'auditor' }
type Assignment = { id: string; name: string; status: string; sha256: string }
type Audit = { id: string; action: string; ip: string; details: string; created_at: string }

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(path, { ...init, credentials: 'include' })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)
  return response.json()
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

  async function refresh(currentUser: User) {
    const token = await api('/api/csrf')
    setCsrf(token.token)
    setAssignments(await api('/api/assignments'))
    if (currentUser.role === 'admin') setUsers(await api('/api/users'))
    if (currentUser.role === 'admin' || currentUser.role === 'auditor') setAudit(await api('/api/audit'))
  }

  useEffect(() => {
    api('/api/me').then((currentUser: User) => {
      setUser(currentUser)
      return refresh(currentUser)
    }).catch(() => undefined)
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
      await api(`/api/documents/${document.id}/assign`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ signer_email: signerEmail }) })
      setFile(null)
      setMessage('Documento asignado correctamente.')
      if (user) await refresh(user)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }

  async function sign(assignmentId: string) {
    setBusy(true)
    try {
      await api(`/api/assignments/${assignmentId}/sign`, { method: 'POST', headers: { 'X-CSRF-Token': csrf } })
      setMessage('Documento firmado y registrado.')
      if (user) await refresh(user)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }

  if (!user) return <main className="min-h-screen bg-ink flex items-center justify-center p-6"><section className="w-full max-w-lg rounded-2xl border border-ink-line bg-ink-surface p-10 text-center"><h1 className="font-display text-3xl text-parchment">SignServer</h1><p className="mt-3 text-parchment-muted">Firma y trazabilidad documental</p><a href="/auth/login" className="mt-8 inline-block rounded-lg bg-seal px-8 py-3 font-medium text-ink">Iniciar sesión con Microsoft</a></section></main>

  return <main className="min-h-screen bg-ink px-6 py-8 text-parchment"><div className="mx-auto max-w-6xl"><header className="flex flex-wrap items-center justify-between gap-4 border-b border-ink-line pb-6"><div><h1 className="font-display text-3xl">Registro de Firmas</h1><p className="mt-1 text-sm text-parchment-muted">{user.name || user.email} · {user.role}</p></div><button onClick={() => api('/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrf } }).then(() => location.reload())} className="rounded-lg border border-ink-line px-4 py-2 text-sm">Cerrar sesión</button></header>
    {message && <p className="my-5 rounded-lg border border-seal/40 bg-seal/10 p-3 text-sm" role="status">{message}</p>}
    {user.role === 'admin' && <section className="mt-8 rounded-2xl border border-ink-line bg-ink-surface p-6"><h2 className="font-display text-2xl">Asignar documento</h2><form onSubmit={uploadAndAssign} className="mt-5 grid gap-4 md:grid-cols-[1fr_1fr_auto]"><input type="file" accept="application/pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="rounded-lg border border-ink-line bg-ink-raised p-3 text-sm" required /><select value={signerEmail} onChange={(event) => setSignerEmail(event.target.value)} className="rounded-lg border border-ink-line bg-ink-raised p-3" required><option value="">Selecciona firmante</option>{users.map((item) => <option key={item.id} value={item.email}>{item.name || item.email}</option>)}</select><button disabled={busy} className="rounded-lg bg-seal px-6 py-3 font-medium text-ink disabled:opacity-50">Subir y asignar</button></form></section>}
    <section className="mt-8 rounded-2xl border border-ink-line bg-ink-surface p-6"><h2 className="font-display text-2xl">{user.role === 'signer' ? 'Mis documentos' : 'Documentos asignados'}</h2><div className="mt-5 divide-y divide-ink-line">{assignments.length === 0 ? <p className="py-5 text-sm text-parchment-muted">No hay documentos asignados.</p> : assignments.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-4 py-4"><div><p>{item.name}</p><p className="mt-1 font-mono text-xs text-parchment-faint">SHA-256: {item.sha256}</p></div><div className="flex items-center gap-3"><span className="text-sm text-parchment-muted">{item.status}</span>{user.role === 'signer' && item.status === 'pending' && <button disabled={busy} onClick={() => sign(item.id)} className="rounded-lg bg-seal px-4 py-2 text-sm text-ink">Firmar</button>}{item.status === 'signed' && <a href={`/api/assignments/${item.id}/download`} className="rounded-lg border border-verified/50 px-4 py-2 text-sm text-verified">Descargar</a>}</div></div>)}</div></section>
    {(user.role === 'admin' || user.role === 'auditor') && <section className="mt-8 rounded-2xl border border-ink-line bg-ink-surface p-6"><h2 className="font-display text-2xl">Auditoría</h2><div className="mt-5 overflow-auto"><table className="w-full text-left text-sm"><thead className="text-parchment-muted"><tr><th className="p-2">Fecha</th><th className="p-2">Evento</th><th className="p-2">IP</th><th className="p-2">Detalle</th></tr></thead><tbody>{audit.map((item) => <tr key={item.id} className="border-t border-ink-line"><td className="p-2 whitespace-nowrap">{new Date(item.created_at).toLocaleString()}</td><td className="p-2">{item.action}</td><td className="p-2">{item.ip}</td><td className="p-2">{item.details}</td></tr>)}</tbody></table></div></section>}
  </div></main>
}
