import type { Floor, FloorStatus } from '../types'
import { formatTokens } from './tower'

// The lobby's building directory: one lit card per agent, the ones that need
// you first. Pure function from data to one SVG document (SMIL animated).

export type DirectoryInput = {
  floors: Floor[]
  meId: string | null
  now: number
}

const W = 360
const HEAD = 34
const ROW = 58
const FOOT = 14
const PIXEL = `font-family="'Press Start 2P','Silkscreen',ui-monospace,Consolas,monospace"`
const SANS = `font-family="'Segoe UI',system-ui,-apple-system,sans-serif"`
const MONO = `font-family="ui-monospace,'Cascadia Mono',Consolas,monospace"`

const ORDER: { [K in FloorStatus]: number } = { needs: 0, working: 1, review: 2, sleeping: 3 }

const LOOK: { [K in FloorStatus]: { color: string; glow: string; label: string; card: string } } = {
  needs: { color: '#ff4d5e', glow: '#ff4d5e', label: 'TE NECESITA', card: '#2a1018' },
  working: { color: '#4f8cff', glow: '#4f8cff', label: 'TRABAJANDO', card: '#0f1a33' },
  review: { color: '#ffc531', glow: '#ffc531', label: 'PARA REVISAR', card: '#2a220b' },
  sleeping: { color: '#6b7895', glow: '#3a4560', label: 'DORMIDO', card: '#121726' },
}

const AVATAR = ['#7c5cff', '#ff7a59', '#16c79a', '#ff5fa2', '#3fa9f5', '#f5a623', '#9b59b6', '#2ec4b6']

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

function ago(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 1) return 'ahora'
  if (m < 60) return `hace ${m} min`
  const h = Math.floor(m / 60)
  return h < 24 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} d`
}

function card(f: Floor, y: number, label: string, isMe: boolean, maxTokens: number, now: number) {
  const look = LOOK[f.status]
  const x = 10
  const w = W - 20
  const h = ROW - 8
  const avatar = AVATAR[hash(f.name) % AVATAR.length] ?? '#7c5cff'
  let g = ''

  // card body, status-tinted, with a lit edge
  g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${look.card}" stroke="${isMe ? '#5ee1ff' : look.color}" stroke-opacity="${isMe ? 0.9 : 0.35}" stroke-width="${isMe ? 1.6 : 1}"/>`
  g += `<rect x="${x}" y="${y + 6}" width="3" height="${h - 12}" rx="1.5" fill="${look.color}"/>`
  if (f.status === 'needs')
    g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="none" stroke="${look.color}" stroke-width="2">` +
      `<animate attributeName="stroke-opacity" values="0.15;0.95;0.15" dur="1.2s" repeatCount="indefinite"/></rect>`

  // elevator button with the floor number, glowing in the status colour
  const bx = x + 22
  const by = y + h / 2
  g += `<circle cx="${bx}" cy="${by}" r="13" fill="#0a0d16" stroke="#3a4257" stroke-width="1.5"/>`
  g += `<circle cx="${bx}" cy="${by}" r="10" fill="${look.glow}" opacity="${f.status === 'sleeping' ? 0.25 : 0.9}" filter="url(#glow)">` +
    (f.status === 'working' || f.status === 'needs'
      ? `<animate attributeName="opacity" values="0.55;1;0.55" dur="${f.status === 'needs' ? 0.9 : 2.2}s" repeatCount="indefinite"/>`
      : '') + `</circle>`
  g += `<text x="${bx}" y="${by + 2.6}" ${PIXEL} font-size="6.5" fill="${f.status === 'sleeping' ? '#aab3c8' : '#0a0d16'}" text-anchor="middle" font-weight="bold">${esc(label)}</text>`

  // pixel avatar with initials
  const ax = x + 42
  const ay = y + 9
  g += `<rect x="${ax}" y="${ay}" width="22" height="22" rx="4" fill="${avatar}"/>`
  g += `<rect x="${ax}" y="${ay + 16}" width="22" height="6" rx="0" fill="#000" opacity="0.18"/>`
  g += `<text x="${ax + 11}" y="${ay + 14.5}" ${PIXEL} font-size="6.5" fill="#fff" text-anchor="middle" font-weight="bold">${esc(f.initials.slice(0, 2))}</text>`
  if ((f.subagents ?? 0) > 0) {
    g += `<circle cx="${ax + 21}" cy="${ay + 1}" r="5.5" fill="#14b8a6" stroke="${look.card}" stroke-width="1.5"/>`
    g += `<text x="${ax + 21}" y="${ay + 3.4}" ${SANS} font-size="7" fill="#fff" text-anchor="middle" font-weight="700">${f.subagents}</text>`
  }

  // name, project chip and status pill
  const tx = x + 72
  g += `<text x="${tx}" y="${y + 15}" ${SANS} font-size="9.5" fill="#f3f5ff" font-weight="700">${isMe ? '<tspan fill="#5ee1ff">TÚ · </tspan>' : ''}${esc(cut(f.name, isMe ? 24 : 29))}</text>`
  const pill = look.label
  const pw = pill.length * 4.4 + 10
  g += `<rect x="${tx}" y="${y + 20}" width="${pw}" height="10" rx="5" fill="${look.color}" fill-opacity="0.18" stroke="${look.color}" stroke-opacity="0.6" stroke-width="0.8"/>`
  g += `<text x="${tx + pw / 2}" y="${y + 27.4}" ${SANS} font-size="6.4" fill="${look.color}" text-anchor="middle" font-weight="700" letter-spacing="0.4">${pill}</text>`
  if (f.project) {
    const proj = cut(f.project, 22)
    const jw = proj.length * 4.2 + 12
    g += `<rect x="${tx + pw + 4}" y="${y + 20}" width="${jw}" height="10" rx="3" fill="#ffffff" fill-opacity="0.06"/>`
    g += `<text x="${tx + pw + 10}" y="${y + 27.3}" ${MONO} font-size="6.4" fill="#9aa6c4">${esc(proj)}</text>`
  }

  // what it is doing, with a caret while it works
  const resting = f.status === 'sleeping' && /^(Pensando|Usando|Ejecutando|Sigo)/.test(f.activity)
  const act = cut(resting ? 'zZ En reposo' : f.activity, 46)
  g += `<text x="${tx}" y="${y + 40}" ${SANS} font-size="7.6" fill="${f.status === 'sleeping' ? '#7d879f' : '#c9d2ea'}">${esc(act)}` +
    (f.status === 'working' ? `<tspan fill="${look.color}"> ▌<animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite"/></tspan>` : '') +
    `</text>`

  // cost and tokens on the right
  const rx = x + w - 10
  g += `<text x="${rx}" y="${y + 16}" ${PIXEL} font-size="8.5" fill="#ffd34d" text-anchor="end" font-weight="bold">$${f.costUsd.toFixed(2)}</text>`
  g += `<text x="${rx}" y="${y + 28}" ${MONO} font-size="7" fill="#3dff8a" text-anchor="end">${formatTokens(f.tokens)} tok</text>`
  g += `<text x="${rx}" y="${y + 40}" ${SANS} font-size="6.4" fill="#6b7895" text-anchor="end">${ago(now - f.changedAt)}</text>`

  // share of tokens among the agents shown
  const barX = tx
  const barW = w - (tx - x) - 12
  const share = maxTokens > 0 ? Math.max(0.02, f.tokens / maxTokens) : 0
  g += `<rect x="${barX}" y="${y + h - 5}" width="${barW}" height="2" rx="1" fill="#ffffff" fill-opacity="0.07"/>`
  g += `<rect x="${barX}" y="${y + h - 5}" width="${(barW * share).toFixed(1)}" height="2" rx="1" fill="url(#bar-${f.status})"/>`
  if (f.status === 'working')
    g += `<rect x="${barX}" y="${y + h - 5}" width="18" height="2" rx="1" fill="#fff" opacity="0.6">` +
      `<animate attributeName="x" from="${barX}" to="${barX + barW * share - 18}" dur="1.6s" repeatCount="indefinite"/></rect>`

  return `<g>${g}</g>`
}

export function renderDirectory({ floors, meId, now }: DirectoryInput) {
  // floor labels match the tower: offices fill two per level, from the bottom
  const labels = new Map<string, string>()
  floors.forEach((f, i) => labels.set(f.id, `${Math.floor(i / 2) + 1}${i % 2 === 0 ? 'A' : 'B'}`))
  const rows = [...floors].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || b.changedAt - a.changedAt,
  )
  const maxTokens = Math.max(0, ...floors.map(f => f.tokens))
  const total = floors.reduce((n, f) => n + f.costUsd, 0)
  const H = HEAD + Math.max(1, rows.length) * ROW + FOOT

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMin meet" style="display:block">`
  svg += `<defs>` +
    `<filter id="glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    `<linearGradient id="panel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#151b2d"/><stop offset="1" stop-color="#0b0f1a"/></linearGradient>` +
    `<linearGradient id="brass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b8892f"/><stop offset="0.5" stop-color="#f6d37a"/><stop offset="1" stop-color="#b8892f"/></linearGradient>` +
    (Object.keys(LOOK) as FloorStatus[]).map(s =>
      `<linearGradient id="bar-${s}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${LOOK[s].color}" stop-opacity="0.35"/><stop offset="1" stop-color="${LOOK[s].color}"/></linearGradient>`,
    ).join('') +
    `</defs>`

  // the directory board: dark panel in a brass frame
  svg += `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="10" fill="url(#panel)" stroke="url(#brass)" stroke-width="2"/>`
  svg += `<circle cx="9" cy="9" r="1.6" fill="#f6d37a"/><circle cx="${W - 9}" cy="9" r="1.6" fill="#f6d37a"/>` +
    `<circle cx="9" cy="${H - 9}" r="1.6" fill="#f6d37a"/><circle cx="${W - 9}" cy="${H - 9}" r="1.6" fill="#f6d37a"/>`
  svg += `<text x="20" y="22" ${PIXEL} font-size="7.5" fill="url(#brass)" font-weight="bold" letter-spacing="1">DIRECTORIO</text>`
  svg += `<text x="104" y="22" ${SANS} font-size="8" fill="#8b95b3">· ${floors.length} ${floors.length === 1 ? 'agente' : 'agentes'} en el edificio</text>`
  svg += `<text x="${W - 20}" y="22" ${PIXEL} font-size="7" fill="#ffd34d" text-anchor="end">$${total.toFixed(2)}</text>`
  svg += `<rect x="16" y="28" width="${W - 32}" height="1" fill="url(#brass)" opacity="0.5"/>`

  if (rows.length === 0)
    svg += `<text x="${W / 2}" y="${HEAD + 26}" ${SANS} font-size="9" fill="#6b7895" text-anchor="middle">El edificio está vacío: abre una sesión de Claude Code</text>`
  rows.forEach((f, i) => {
    svg += card(f, HEAD + i * ROW, labels.get(f.id) ?? '?', f.id === meId, maxTokens, now)
  })

  svg += `</svg>`
  return { svg, height: H, width: W }
}
