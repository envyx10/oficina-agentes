import type { Floor, Weather } from '../types'

// Pixel-art skyscraper: every Claude Code session is a floor.
// Pure function from data to one SVG document (SMIL animated).

export type TowerInput = {
  floors: Floor[]
  meId: string | null
  weather: Weather | null
  historic: number
  tpm: number
  hour: number
  latest: string | null
}

const W = 360
const SKY = 112
const ROOF = 18
const FH = 66
const LOBBY = 40
const STREET = 14
const BOARD = 92
const TX = 34
const ROOM_W = 128
const SHAFT_W = 36
const LX = TX + 4
const SX = LX + ROOM_W
const RX = SX + SHAFT_W
const TW = ROOM_W * 2 + SHAFT_W + 8
const FONT = `font-family="'Press Start 2P','Silkscreen',ui-monospace,Consolas,monospace"`

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

export const formatTokens = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`

type Phase = 'day' | 'sunset' | 'night'
const phaseOf = (h: number): Phase => (h >= 8 && h < 18 ? 'day' : h >= 18 && h < 21 ? 'sunset' : h >= 6 && h < 8 ? 'sunset' : 'night')

const SKY_COLORS: Record<Phase, [string, string]> = {
  day: ['#5b9be0', '#a9d3f5'],
  sunset: ['#3b2d5c', '#f08a4b'],
  night: ['#070b1c', '#1b2550'],
}

function cloud(x: number, y: number, s: number, dur: number, delay: number, color: string) {
  const r = (dx: number, dy: number, w: number, h: number) =>
    `<rect x="${dx * s}" y="${dy * s}" width="${w * s}" height="${h * s}"/>`
  return `<g fill="${color}" opacity="0.95"><g>${r(2, 0, 6, 2)}${r(0, 2, 12, 2)}${r(1, 4, 10, 1)}` +
    `<animateTransform attributeName="transform" type="translate" from="${x - W - 60} ${y}" to="${x + W + 60} ${y}" dur="${dur}s" begin="-${delay}s" repeatCount="indefinite"/></g></g>`
}

function skyline(phase: Phase, groundY: number) {
  const fill = phase === 'night' ? '#111833' : phase === 'sunset' ? '#3a3355' : '#8fb6dc'
  const lit = phase === 'day' ? '#b8d3ee' : '#ffd36b'
  const blocks: [number, number, number][] = [
    [0, 40, 70], [26, 30, 110], [300, 26, 95], [322, 38, 60], [346, 20, 120], [-6, 16, 130],
  ]
  let out = ''
  for (const [x, w, h] of blocks) {
    const y = groundY - h
    out += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`
    for (let wy = y + 6; wy < groundY - 6; wy += 9)
      for (let wx = x + 4; wx < x + w - 4; wx += 7)
        if (((wx * 7 + wy * 13) % 5) < (phase === 'day' ? 1 : 3))
          out += `<rect x="${wx}" y="${wy}" width="3" height="4" fill="${lit}" opacity="${phase === 'day' ? 0.5 : 0.85}"/>`
  }
  return out
}

function emptyRoom(x: number, y: number) {
  const h = FH
  return `<g>
  <rect x="${x}" y="${y}" width="${ROOM_W}" height="${h}" fill="#ecebe6"/>
  <rect x="${x}" y="${y + h - 8}" width="${ROOM_W}" height="4" fill="#cfc8ba"/>
  <rect x="${x + ROOM_W - 30}" y="${y + 10}" width="20" height="${h - 22}" fill="#7fb2e5" stroke="#4c6f95"/>
  <rect x="${x + ROOM_W - 21}" y="${y + 10}" width="2" height="${h - 22}" fill="#4c6f95"/>
  <rect x="${x + 14}" y="${y + 24}" width="58" height="14" fill="#191919" stroke="#c9a227"/>
  <text x="${x + 43}" y="${y + 34}" ${FONT} font-size="6.5" fill="#f2c94c" text-anchor="middle" font-weight="bold">EN VENTA</text>
  <g stroke="#b88a4a" stroke-width="2"><line x1="${x + 82}" y1="${y + 14}" x2="${x + 82}" y2="${y + h - 8}"/><line x1="${x + 92}" y1="${y + 14}" x2="${x + 92}" y2="${y + h - 8}"/></g>
  <g stroke="#b88a4a" stroke-width="1.5">${[0, 1, 2, 3, 4].map(i => `<line x1="${x + 82}" y1="${y + 20 + i * 8}" x2="${x + 92}" y2="${y + 20 + i * 8}"/>`).join('')}</g>
</g>`
}

function room(x: number, y: number, f: Floor, isMe: boolean, phase: Phase) {
  const h = FH
  const s = f.status
  const dark = s === 'sleeping'
  const wall = dark ? '#222b45' : s === 'review' ? '#f3ecd2' : '#e9e3d5'
  const winFill = phase === 'day' ? '#86b9ea' : phase === 'sunset' ? '#f2a46b' : '#1a2550'
  const screen = s === 'working' ? '#2f8cff' : s === 'review' ? '#2ecc71' : s === 'needs' ? '#ff4d4d' : '#0b0f1a'
  const deskY = y + h - 22
  let g = `<rect x="${x}" y="${y}" width="${ROOM_W}" height="${h}" fill="${wall}"/>`
  // floor boards
  g += `<rect x="${x}" y="${y + h - 8}" width="${ROOM_W}" height="4" fill="${dark ? '#151b2e' : '#b9a58a'}"/>`
  // window
  g += `<rect x="${x + ROOM_W - 26}" y="${y + 13}" width="18" height="${h - 25}" fill="${winFill}" stroke="${dark ? '#3a4670' : '#4c6f95'}"/>`
  g += `<rect x="${x + ROOM_W - 18}" y="${y + 13}" width="2" height="${h - 25}" fill="${dark ? '#3a4670' : '#4c6f95'}"/>`
  // label strip: name + cost
  g += `<rect x="${x}" y="${y}" width="${ROOM_W}" height="10" fill="#0e1424"/>`
  g += `<text x="${x + 3}" y="${y + 7.4}" ${FONT} font-size="5.2" fill="${isMe ? '#5ee1ff' : '#c7d2fe'}">${isMe ? '▶ ' : ''}${esc(cut(f.name, isMe ? 17 : 19))}</text>`
  g += `<text x="${x + ROOM_W - 3}" y="${y + 7.4}" ${FONT} font-size="5.2" fill="#ffd34d" text-anchor="end">$${f.costUsd.toFixed(2)}</text>`
  // initials badge
  g += `<rect x="${x + 6}" y="${y + 15}" width="22" height="17" fill="#2d3a66" stroke="#7c8fe0"/>`
  g += `<text x="${x + 17}" y="${y + 26.5}" ${FONT} font-size="7" fill="#ffffff" text-anchor="middle" font-weight="bold">${esc(f.initials)}</text>`
  // server rack with blinking LEDs
  g += `<rect x="${x + 6}" y="${y + 36}" width="10" height="${h - 44}" fill="#1b1f2b"/>`
  for (let i = 0; i < 3; i++) {
    const led = `<rect x="${x + 8}" y="${y + 39 + i * 6}" width="2" height="2" fill="${s === 'needs' ? '#ff4d4d' : '#3dff8a'}">` +
      (s === 'working' ? `<animate attributeName="opacity" values="1;0.2;1" dur="${0.6 + i * 0.35}s" repeatCount="indefinite"/>` : '') + '</rect>'
    g += led
  }
  // desk + monitor
  g += `<rect x="${x + 30}" y="${deskY}" width="48" height="3" fill="#6b4a2f"/>`
  g += `<rect x="${x + 32}" y="${deskY + 3}" width="2" height="11" fill="#6b4a2f"/><rect x="${x + 74}" y="${deskY + 3}" width="2" height="11" fill="#6b4a2f"/>`
  g += `<rect x="${x + 40}" y="${deskY - 18}" width="28" height="17" fill="#111"/>`
  g += `<rect x="${x + 42}" y="${deskY - 16}" width="24" height="12" fill="${screen}"/>`
  g += `<rect x="${x + 52}" y="${deskY - 1}" width="4" height="1" fill="#111"/>`
  if (s === 'working') {
    for (let i = 0; i < 3; i++)
      g += `<rect x="${x + 44}" y="${deskY - 14 + i * 3.5}" width="${8 + ((i * 7) % 12)}" height="1.5" fill="#d6ecff">` +
        `<animate attributeName="width" values="2;${10 + i * 4};${6 + i * 3};2" dur="${1.4 + i * 0.4}s" repeatCount="indefinite"/></rect>`
  } else if (s === 'review') {
    g += `<text x="${x + 54}" y="${deskY - 6.5}" ${FONT} font-size="7" fill="#fff" text-anchor="middle">✓</text>`
  } else if (s === 'needs') {
    g += `<text x="${x + 54}" y="${deskY - 6}" ${FONT} font-size="8" fill="#fff" text-anchor="middle" font-weight="bold">!</text>`
  }
  // the agent at the desk
  if (!dark) {
    const bob = s === 'working' ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -1;0 0" dur="0.8s" repeatCount="indefinite"/>` : ''
    g += `<g>${bob}<rect x="${x + 82}" y="${deskY - 14}" width="7" height="7" fill="#f1c27d"/>` +
      `<rect x="${x + 82}" y="${deskY - 15}" width="7" height="2" fill="#3b2a1a"/>` +
      `<rect x="${x + 80}" y="${deskY - 7}" width="11" height="10" fill="${s === 'needs' ? '#d33' : '#5b6ee1'}"/></g>`
    g += `<rect x="${x + 79}" y="${deskY + 3}" width="13" height="3" fill="#c0392b"/><rect x="${x + 84}" y="${deskY + 6}" width="3" height="8" fill="#555"/>`
  } else {
    g += `<text x="${x + 86}" y="${y + 34}" ${FONT} font-size="6" fill="#8ea2ff" opacity="0.8">z<animate attributeName="y" values="${y + 36};${y + 26};${y + 36}" dur="3s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;0.9;0" dur="3s" repeatCount="indefinite"/></text>`
    g += `<text x="${x + 92}" y="${y + 28}" ${FONT} font-size="5" fill="#8ea2ff" opacity="0.6">z<animate attributeName="opacity" values="0.9;0;0.9" dur="3s" repeatCount="indefinite"/></text>`
  }
  // subagents working for this agent: little helpers beside the desk
  const helpers = Math.min(3, f.subagents ?? 0)
  for (let i = 0; i < helpers; i++) {
    const hx = x + 30 + i * 9
    g += `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -1.5;0 0" dur="${0.5 + i * 0.15}s" repeatCount="indefinite"/>` +
      `<rect x="${hx}" y="${deskY + 4}" width="5" height="5" fill="#f1c27d"/><rect x="${hx - 1}" y="${deskY + 9}" width="7" height="6" fill="#14b8a6"/></g>`
  }
  if ((f.subagents ?? 0) > 3)
    g += `<text x="${x + 58}" y="${deskY + 13}" ${FONT} font-size="5" fill="#14b8a6">+${(f.subagents ?? 0) - 3}</text>`
  // plant
  g += `<rect x="${x + 98}" y="${deskY + 8}" width="6" height="6" fill="#8b5a2b"/><rect x="${x + 96}" y="${deskY + 1}" width="10" height="7" fill="#2f9e44"/>`
  // tokens counter
  g += `<rect x="${x + 30}" y="${y + 14}" width="30" height="10" fill="#000" stroke="#1f7a3a"/>`
  g += `<text x="${x + 45}" y="${y + 21.6}" ${FONT} font-size="5.4" fill="#3dff8a" text-anchor="middle">${formatTokens(f.tokens)}</text>`
  // status overlays
  if (s === 'needs') {
    g += `<rect x="${x + 1}" y="${y + 1}" width="${ROOM_W - 2}" height="${h - 2}" fill="#ff2b2b" stroke="#ff6b6b" stroke-width="2" opacity="0.4">` +
      `<animate attributeName="opacity" values="0.25;0.55;0.25" dur="1.4s" repeatCount="indefinite"/></rect>`
    g += bubble(x, y + 30, '¡Te necesito! Necesito tu OK', '#ff4d4d')
  } else if (s === 'review') {
    g += `<rect x="${x + 1.5}" y="${y + 1.5}" width="${ROOM_W - 3}" height="${h - 3}" fill="none" stroke="#f5c518" stroke-width="3"/>`
    g += bubble(x, y + 30, 'Terminado: revísalo', '#f5c518')
  }
  return `<g>${g}</g>`
}

function bubble(x: number, y: number, text: string, dot: string) {
  const w = Math.min(ROOM_W - 10, text.length * 3.7 + 14)
  const bx = x + (ROOM_W - w) / 2
  return `<g><rect x="${bx}" y="${y}" width="${w}" height="10" fill="#fff" stroke="#222"/>` +
    `<rect x="${bx + 3}" y="${y + 3.5}" width="3" height="3" fill="${dot}"/>` +
    `<text x="${bx + 8}" y="${y + 7.2}" ${FONT} font-size="4.6" fill="#111">${esc(text)}</text></g>`
}

export function renderTower(input: TowerInput) {
  const { meId, weather, historic, tpm, hour, latest } = input
  // the drawing is held to 131072 characters: at most 24 offices, the newest kept
  const floors = input.floors.length > 24 ? [...input.floors].sort((a, b) => b.changedAt - a.changedAt).slice(0, 24).sort((a, b) => a.startedAt - b.startedAt) : input.floors
  const phase = phaseOf(hour)
  const slots = Math.max(6, floors.length + (floors.length % 2 === 0 ? 2 : 1))
  const levels = Math.ceil(slots / 2)
  const towerTop = SKY
  const groundY = towerTop + ROOF + levels * FH + LOBBY
  const H = groundY + STREET + BOARD
  const [skyTop, skyBottom] = SKY_COLORS[phase]

  // floors[0] sits at the bottom: level 0 is the lowest office floor
  const floorY = (level: number) => towerTop + ROOF + (levels - 1 - level) * FH

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMin meet" style="display:block" shape-rendering="crispEdges">`
  svg += `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${skyTop}"/><stop offset="1" stop-color="${skyBottom}"/></linearGradient></defs>`
  svg += `<rect width="${W}" height="${groundY}" fill="url(#sky)"/>`

  // stars / sun / moon
  if (phase === 'night') {
    for (let i = 0; i < 28; i++) {
      const sx = (i * 97) % W, sy = (i * 53) % (SKY - 10)
      svg += `<rect x="${sx}" y="${sy}" width="1.5" height="1.5" fill="#fff"><animate attributeName="opacity" values="1;0.2;1" dur="${2 + (i % 5)}s" repeatCount="indefinite"/></rect>`
    }
    svg += `<circle cx="${W - 30}" cy="30" r="11" fill="#f4f1d0"/><circle cx="${W - 25}" cy="27" r="10" fill="${skyTop}"/>`
  } else {
    svg += `<circle cx="${W - 30}" cy="${phase === 'day' ? 30 : 70}" r="12" fill="${phase === 'day' ? '#ffe066' : '#ffb347'}"><animate attributeName="r" values="12;13;12" dur="4s" repeatCount="indefinite"/></circle>`
  }
  const temp = weather ? `${Math.round(weather.tempC)}°` : '--°'
  svg += `<text x="${W - 50}" y="28" ${FONT} font-size="11" fill="#fff" text-anchor="end" font-weight="bold">${temp}</text>`
  svg += `<text x="${W - 50}" y="38" ${FONT} font-size="5" fill="#fff" text-anchor="end" opacity="0.9">${esc((weather?.city ?? '').toUpperCase())}${weather ? ' · ' + esc(weather.label.toUpperCase()) : ''}</text>`

  // clouds
  const cc = phase === 'night' ? '#2a3466' : '#ffffff'
  svg += cloud(20, 18, 3, 70, 10, cc) + cloud(140, 52, 2, 55, 30, cc) + cloud(260, 82, 2.5, 90, 60, cc)

  svg += skyline(phase, groundY)

  // tower body
  svg += `<rect x="${TX}" y="${towerTop}" width="${TW}" height="${groundY - towerTop}" fill="#2a2f3a"/>`
  // roof + antenna + beacon
  svg += `<rect x="${TX - 3}" y="${towerTop}" width="${TW + 6}" height="${ROOF - 4}" fill="#3b4150"/>`
  svg += `<text x="${TX + TW / 2}" y="${towerTop + 10}" ${FONT} font-size="6" fill="#cfd8ff" text-anchor="middle">ÁTICO DEL JEFE</text>`
  svg += `<rect x="${TX + 20}" y="${towerTop - 26}" width="2" height="26" fill="#9aa3b5"/>`
  svg += `<circle cx="${TX + 21}" cy="${towerTop - 27}" r="2.5" fill="#ff3b3b"><animate attributeName="opacity" values="1;0.1;1" dur="1.2s" repeatCount="indefinite"/></circle>`

  // elevator shaft
  const shaftTop = towerTop + ROOF
  svg += `<rect x="${SX}" y="${shaftTop}" width="${SHAFT_W}" height="${groundY - shaftTop - LOBBY}" fill="#0d121c"/>`
  svg += `<line x1="${SX + SHAFT_W / 2}" y1="${shaftTop}" x2="${SX + SHAFT_W / 2}" y2="${groundY - LOBBY}" stroke="#3b82f6" stroke-width="1"/>`

  // offices
  for (let i = 0; i < slots; i++) {
    const level = Math.floor(i / 2)
    const x = i % 2 === 0 ? LX : RX
    const y = floorY(level)
    const f = floors[i]
    svg += f ? room(x, y, f, f.id === meId, phase) : emptyRoom(x, y)
  }
  for (let l = 0; l < levels; l++) {
    const y = floorY(l) + FH - 4
    svg += `<rect x="${TX}" y="${y}" width="${TW}" height="4" fill="#3b3f4a"/>`
  }

  // elevator car: visits floors with active agents, carrying messages
  const stops = floors
    .map((f, i) => ({ f, level: Math.floor(i / 2) }))
    .filter(({ f }) => f.status === 'working' || f.status === 'needs')
    .map(({ level }) => floorY(level) + FH - 30)
  const lobbyY = groundY - LOBBY - 26
  const path = [lobbyY, ...stops, lobbyY]
  const carX = SX + 7
  let car = `<rect x="0" y="0" width="22" height="24" fill="#4b6cb7" stroke="#a9bcff"/>` +
    `<rect x="3" y="3" width="16" height="8" fill="#9fd0ff"/><rect x="10" y="12" width="2" height="12" fill="#2b3f74"/>`
  if (stops.length > 0) car += `<rect x="6" y="14" width="10" height="6" fill="#fff" stroke="#c0392b"/><path d="M6 14 L11 18 L16 14" fill="none" stroke="#c0392b"/>`
  if (path.length > 2) {
    const values = path.flatMap(y => [`${carX} ${y}`, `${carX} ${y}`]).join(';')
    svg += `<g transform="translate(${carX} ${lobbyY})">${car}<animateTransform attributeName="transform" type="translate" values="${values}" dur="${path.length * 2.4}s" repeatCount="indefinite"/></g>`
  } else {
    svg += `<g transform="translate(${carX} ${lobbyY})">${car}</g>`
  }

  // lobby
  const ly = groundY - LOBBY
  svg += `<rect x="${TX}" y="${ly}" width="${TW}" height="${LOBBY}" fill="#1d2433"/>`
  svg += `<rect x="${TX + TW / 2 - 60}" y="${ly + 4}" width="120" height="12" fill="#0b0f1a" stroke="#7c8fe0"/>`
  svg += `<text x="${TX + TW / 2}" y="${ly + 12.5}" ${FONT} font-size="6.5" fill="#a78bfa" text-anchor="middle" font-weight="bold">MI OFICINA · IA</text>`
  for (let i = 0; i < 4; i++)
    svg += `<rect x="${TX + 22 + i * 70}" y="${ly + 20}" width="30" height="20" fill="${phase === 'day' ? '#9cc7ef' : '#ffd36b'}" stroke="#4c6f95" opacity="0.9"/>`

  // street
  svg += `<rect x="0" y="${groundY}" width="${W}" height="${STREET}" fill="#4a4d55"/>`
  svg += `<rect x="0" y="${groundY}" width="${W}" height="3" fill="#8a8f99"/>`
  for (let x = 6; x < W; x += 26) svg += `<rect x="${x}" y="${groundY + 8}" width="12" height="2" fill="#e8e8e8"/>`
  // a little car driving by
  svg += `<g><rect x="0" y="${groundY + 4}" width="18" height="6" fill="#e74c3c"/><rect x="4" y="${groundY + 1}" width="9" height="4" fill="#c0392b"/>` +
    `<animateTransform attributeName="transform" type="translate" from="-30 0" to="${W + 30} 0" dur="9s" repeatCount="indefinite"/></g>`

  // data center billboard: historic tokens
  const by = groundY + STREET
  svg += `<rect x="0" y="${by}" width="${W}" height="${BOARD}" fill="#141821"/>`
  svg += `<rect x="12" y="${by + 6}" width="${W - 24}" height="${BOARD - 12}" fill="#0b1020" stroke="#2c3a66" stroke-width="2"/>`
  svg += `<text x="${W / 2}" y="${by + 18}" ${FONT} font-size="5.4" fill="#7dd3fc" text-anchor="middle">CENTRO DE DATOS · TOKENS GENERADOS (TOTAL HISTÓRICO)</text>`
  const digits = String(Math.max(0, Math.floor(historic))).padStart(12, '0').slice(-12)
  const dw = 22, dx0 = (W - dw * 12) / 2
  const firstSig = digits.search(/[1-9]/)
  for (let i = 0; i < 12; i++) {
    const lead = firstSig === -1 || i < firstSig
    const x = dx0 + i * dw
    svg += `<rect x="${x + 1}" y="${by + 25}" width="${dw - 2}" height="26" fill="${lead ? '#1e3a8a' : '#f5f5f5'}" stroke="#000"/>`
    svg += `<rect x="${x + 1}" y="${by + 37.5}" width="${dw - 2}" height="1" fill="#000" opacity="0.4"/>`
    svg += `<text x="${x + dw / 2}" y="${by + 43}" ${FONT} font-size="14" fill="${lead ? '#93c5fd' : '#111'}" text-anchor="middle" font-weight="bold">${digits[i]}` +
      (i === 11 ? `<animate attributeName="opacity" values="1;0.35;1" dur="0.9s" repeatCount="indefinite"/>` : '') + `</text>`
  }
  const big = historic >= 1e9 ? `${(historic / 1e9).toFixed(1).replace('.', ',')} MIL MILLONES DE TOKENS` : historic >= 1e6 ? `${(historic / 1e6).toFixed(1).replace('.', ',')} MILLONES DE TOKENS` : `${Math.floor(historic).toLocaleString('es-ES')} TOKENS`
  svg += `<text x="${W / 2}" y="${by + 63}" ${FONT} font-size="5.6" fill="#e5e7eb" text-anchor="middle">${big} · +${Math.round(tpm).toLocaleString('es-ES')} / MIN</text>`
  for (let i = 0; i < 5; i++) {
    svg += `<rect x="${30 + i * 64}" y="${by + 70}" width="44" height="12" fill="#1f2937" stroke="#374151"/>`
    for (let j = 0; j < 6; j++)
      svg += `<rect x="${34 + i * 64 + j * 6}" y="${by + 74}" width="3" height="3" fill="#3dff8a"><animate attributeName="opacity" values="1;0.15;1" dur="${0.5 + ((i + j) % 4) * 0.3}s" repeatCount="indefinite"/></rect>`
  }

  // carrier pigeon with the latest news
  if (latest) {
    const label = esc(cut(latest, 40))
    const bw = label.length * 4.1 + 30
    svg += `<g><g>` +
      `<rect x="0" y="0" width="${bw}" height="11" fill="#fff4c2" stroke="#c9a227"/>` +
      `<rect x="3" y="2.5" width="9" height="6" fill="#fff" stroke="#d44"/><path d="M3 2.5 L7.5 6 L12 2.5" fill="none" stroke="#d44"/>` +
      `<text x="15" y="7.8" ${FONT} font-size="5" fill="#222">${label}</text>` +
      `<line x1="${bw}" y1="5" x2="${bw + 10}" y2="5" stroke="#888"/>` +
      `<g transform="translate(${bw + 10} -2)"><rect x="0" y="4" width="10" height="5" fill="#f5f5f5"/><rect x="9" y="3" width="4" height="4" fill="#f5f5f5"/><rect x="13" y="4.5" width="2" height="1.5" fill="#f39c12"/>` +
      `<rect x="2" y="0" width="6" height="4" fill="#ddd"><animate attributeName="height" values="4;1;4" dur="0.35s" repeatCount="indefinite"/></rect></g>` +
      `</g><animateTransform attributeName="transform" type="translate" from="${-bw - 40} 64" to="${W + 10} 58" dur="16s" repeatCount="indefinite"/></g>`
  }

  svg += `</svg>`
  return { svg, height: H, width: W }
}
