const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function initMotion() {
  // Aparición gradual (opacidad 0 a 100) de las ventanas .reveal al bajar
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) }
  }), { threshold: 0.1, rootMargin: '0px 0px -8% 0px' })
  const scan = (root: ParentNode) => root.querySelectorAll('.reveal:not(.in)').forEach((el) => io.observe(el))
  scan(document)
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
    if (n instanceof HTMLElement) { if (n.matches('.reveal')) io.observe(n); scan(n) }
  }))).observe(document.body, { childList: true, subtree: true })

  // Ripple en cualquier .btn
  document.addEventListener('pointerdown', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.btn')
    if (!b || (b as HTMLButtonElement).disabled || reduced()) return
    const r = b.getBoundingClientRect()
    const d = Math.max(r.width, r.height) * 2
    const s = document.createElement('span')
    s.className = 'ripple'
    s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`
    b.appendChild(s)
    setTimeout(() => s.remove(), 800)
  })
  // Foco de luz que sigue al cursor sobre las tarjetas .spot
  let raf = 0
  document.addEventListener('pointermove', (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('.spot')
    if (!c) return
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      const r = c.getBoundingClientRect()
      c.style.setProperty('--mx', `${e.clientX - r.left}px`)
      c.style.setProperty('--my', `${e.clientY - r.top}px`)
    })
  }, { passive: true })
}

// Explosión de partículas desde un elemento (sello al firmar / validar)
export function burst(target: Element | null, tone: 'gold' | 'green' = 'gold', count = 30) {
  if (!target || reduced()) return
  const r = target.getBoundingClientRect()
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2
  const pal = tone === 'gold' ? ['#D4AE68', '#B8934A', '#F2DCA5', '#fff'] : ['#4C9A6A', '#7BC796', '#BFE8CF', '#fff']
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span')
    const size = 3 + Math.random() * 5
    p.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;width:${size}px;height:${size * (Math.random() > 0.5 ? 1 : 2.2)}px;background:${pal[i % pal.length]};border-radius:${Math.random() > 0.5 ? '50%' : '1px'};pointer-events:none;z-index:9999`
    const a = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5
    const dist = 70 + Math.random() * 120
    const dx = Math.cos(a) * dist, dy = Math.sin(a) * dist * 0.8
    const rot = Math.random() * 540 - 270
    document.body.appendChild(p)
    p.animate([
      { transform: 'translate(-50%,-50%) rotate(0)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(calc(-50% + ${dx * 1.1}px),calc(-50% + ${dy + 90}px)) rotate(${rot}deg) scale(.3)`, opacity: 0 },
    ], { duration: 900 + Math.random() * 600, easing: 'cubic-bezier(.16,1,.3,1)' }).onfinish = () => p.remove()
  }
}