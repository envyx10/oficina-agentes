// Watches every Claude Code transcript under ~/.claude/projects and prints,
// every two seconds, one JSON line with the state of each recent session.
// Reads each file incrementally (only the bytes appended since last time) and
// keeps its progress in ~/.claude/oficina-agentes/scan-cache.json.
'use strict'
const fs = require('fs')
const path = require('path')
const os = require('os')

const HOME = os.homedir()
const PROJECTS = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude'), 'projects')
const OUT_DIR = path.join(HOME, '.claude', 'oficina-agentes')
const CACHE = path.join(OUT_DIR, 'scan-cache.json')
const RECENT_MS = 8 * 3600_000
const MAX_SESSIONS = 40
const CACHE_VERSION = 2

// $ per million tokens: input, output, cache write, cache read
const PRICES = [
  [/haiku/i, [1, 5, 1.25, 0.1]],
  [/sonnet/i, [3, 15, 3.75, 0.3]],
  [/.*/, [5, 25, 6.25, 0.5]],
]

let cache = { version: CACHE_VERSION, files: {} }
try {
  const loaded = JSON.parse(fs.readFileSync(CACHE, 'utf8'))
  if (loaded.version === CACHE_VERSION) cache = loaded
} catch {}
let dirty = false

function blank() {
  return {
    offset: 0, tokens: 0, cost: 0, lastMsgId: null, title: null, agentName: null,
    firstPrompt: null, lastKind: null, lastAt: 0, firstAt: 0, pendingTool: null, activity: null, cwd: null, model: null,
  }
}

const base = p => (p ? String(p).split(/[\\/]/).filter(Boolean).pop() : '')
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

function describeTool(name, input) {
  input = input || {}
  const file = base(input.file_path || input.notebook_path || input.path)
  switch (name) {
    case 'Bash': case 'PowerShell': return 'Ejecutando: ' + short(input.description || input.command || '', 40)
    case 'Read': return 'Leyendo ' + file
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return 'Editando ' + file
    case 'Write': return 'Escribiendo ' + file
    case 'Grep': return 'Buscando "' + short(input.pattern || '', 24) + '"'
    case 'Glob': return 'Buscando ' + short(input.pattern || '', 24)
    case 'Agent': case 'Task': return 'Delegando: ' + short(input.description || '', 34)
    case 'WebFetch': try { return 'Leyendo ' + new URL(input.url).host } catch { return 'Navegando' }
    case 'WebSearch': return 'Buscando en la web'
    case 'AskUserQuestion': return '¡Te necesito! Tengo una pregunta'
    case 'ExitPlanMode': return '¡Te necesito! Revisa mi plan'
    default: return 'Usando ' + (name.startsWith('mcp__') ? name.split('__').slice(1).join(' ') : name)
  }
}

function costOf(model, u) {
  const [, p] = PRICES.find(([re]) => re.test(model || ''))
  return ((u.input_tokens || 0) * p[0] + (u.output_tokens || 0) * p[1] +
    (u.cache_creation_input_tokens || 0) * p[2] + (u.cache_read_input_tokens || 0) * p[3]) / 1e6
}

function promptText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const t = content.find(c => c && c.type === 'text')
    return t ? t.text : null
  }
  return null
}

function apply(st, d) {
  const at = d.timestamp ? Date.parse(d.timestamp) : 0
  if (d.type === 'custom-title' && d.customTitle) st.title = d.customTitle
  if (d.type === 'agent-name' && d.agentName) st.agentName = d.agentName
  if (d.cwd) st.cwd = d.cwd
  if (d.type === 'user' && d.message) {
    if (at) { st.lastAt = at; if (!st.firstAt) st.firstAt = at }
    const content = d.message.content
    const hasResult = Array.isArray(content) && content.some(c => c && c.type === 'tool_result')
    if (hasResult) {
      st.lastKind = 'toolResult'; st.pendingTool = null
    } else if (!d.isMeta) {
      const text = promptText(content)
      if (text == null) return
      if (/^\[Request interrupted/.test(text)) { st.lastKind = 'interrupted'; st.pendingTool = null; return }
      if (/^<(command|local-command|task-notification|system-reminder)/.test(text.trim())) return
      st.lastKind = 'prompt'; st.pendingTool = null; st.activity = 'Pensando…'
      if (!st.firstPrompt) st.firstPrompt = short(text.replace(/\s+/g, ' ').trim(), 60)
    }
  }
  if (d.type === 'assistant' && d.message) {
    const m = d.message
    if (at) { st.lastAt = at; if (!st.firstAt) st.firstAt = at }
    if (m.model && m.model !== '<synthetic>') st.model = m.model
    if (m.id && m.id !== st.lastMsgId && m.usage) {
      const u = m.usage
      st.tokens += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
      st.cost += costOf(m.model, u)
      st.lastMsgId = m.id
    }
    for (const c of m.content || []) {
      if (c.type === 'tool_use') { st.lastKind = 'toolUse'; st.pendingTool = c.name; st.activity = describeTool(c.name, c.input) }
      else if (c.type === 'text' && c.text && c.text.trim()) { st.lastKind = 'text' }
      else if (c.type === 'thinking') { if (st.lastKind !== 'toolUse') st.lastKind = 'thinking'; st.activity = 'Pensando…' }
    }
    if (m.stop_reason === 'end_turn' || m.stop_reason === 'stop_sequence') { st.lastKind = 'answer'; st.pendingTool = null; st.activity = 'Terminado: revísalo' }
  }
}

function readNew(file, size) {
  let st = cache.files[file]
  if (!st || size < st.offset) st = cache.files[file] = blank()
  if (size === st.offset) return st
  const fd = fs.openSync(file, 'r')
  try {
    const CHUNK = 8 * 1024 * 1024
    let pos = st.offset
    let carry = ''
    while (pos < size) {
      const len = Math.min(CHUNK, size - pos)
      const buf = Buffer.alloc(len)
      fs.readSync(fd, buf, 0, len, pos)
      pos += len
      const text = carry + buf.toString('utf8')
      const lines = text.split('\n')
      carry = lines.pop()
      for (const line of lines) {
        if (!line) continue
        try { apply(st, JSON.parse(line)) } catch {}
      }
    }
    // keep a trailing partial line for the next read
    st.offset = size - Buffer.byteLength(carry, 'utf8')
  } finally {
    fs.closeSync(fd)
  }
  dirty = true
  return st
}

function statusOf(st, mtime, now) {
  const quiet = now - mtime
  switch (st.lastKind) {
    case 'answer': return now - mtime < 45 * 60_000 ? 'review' : 'sleeping'
    case 'toolUse':
      if (st.pendingTool === 'AskUserQuestion' || st.pendingTool === 'ExitPlanMode') return 'needs'
      if (quiet > 60_000 && quiet < 6 * 3600_000) return 'needs'
      return quiet < 6 * 3600_000 ? 'working' : 'sleeping'
    case 'prompt': case 'toolResult': case 'thinking': case 'text':
      return quiet < 120_000 ? 'working' : 'sleeping'
    default: return 'sleeping'
  }
}

function scan() {
  const now = Date.now()
  const sessions = []
  let historic = 0
  let projects = []
  try { projects = fs.readdirSync(PROJECTS, { withFileTypes: true }).filter(d => d.isDirectory()) } catch {}
  for (const proj of projects) {
    const pdir = path.join(PROJECTS, proj.name)
    let entries = []
    try { entries = fs.readdirSync(pdir, { withFileTypes: true }) } catch { continue }
    for (const ent of entries) {
      if (!ent.isFile() || !ent.name.endsWith('.jsonl')) continue
      const file = path.join(pdir, ent.name)
      let stat
      try { stat = fs.statSync(file) } catch { continue }
      let st
      try { st = readNew(file, stat.size) } catch { continue }
      const id = ent.name.slice(0, -6)
      // subagents of this session
      let subTokens = 0, subWorking = 0, subCost = 0
      const subDir = path.join(pdir, id, 'subagents')
      let subs = []
      try { subs = fs.readdirSync(subDir).filter(n => n.endsWith('.jsonl')) } catch {}
      for (const sub of subs) {
        const sf = path.join(subDir, sub)
        try {
          const ss = fs.statSync(sf)
          const sst = readNew(sf, ss.size)
          subTokens += sst.tokens; subCost += sst.cost
          if (now - ss.mtimeMs < 60_000 && sst.lastKind !== 'answer') subWorking++
        } catch {}
      }
      historic += st.tokens + subTokens
      if (now - stat.mtimeMs > RECENT_MS || !st.lastKind) continue
      const name = st.title || st.agentName || st.firstPrompt || base(st.cwd) || id.slice(0, 8)
      sessions.push({
        id,
        name,
        project: base(st.cwd),
        status: statusOf(st, stat.mtimeMs, now),
        activity: st.activity || 'Esperando instrucciones',
        tokens: st.tokens + subTokens,
        costUsd: Math.round((st.cost + subCost) * 100) / 100,
        startedAt: st.firstAt || stat.birthtimeMs || stat.mtimeMs,
        changedAt: stat.mtimeMs,
        subagents: subWorking,
        model: st.model || '',
      })
    }
  }
  sessions.sort((a, b) => b.changedAt - a.changedAt)
  return { sessions: sessions.slice(0, MAX_SESSIONS), historic, at: now }
}

function saveCache() {
  if (!dirty) return
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    const tmp = CACHE + '.' + process.pid + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(cache))
    fs.renameSync(tmp, CACHE)
    dirty = false
  } catch {}
}

// Where this machine is, for the weather and the sky. The operating system's own
// location (Windows location services: Wi-Fi or GPS) first, which is where you
// really are; the public IP only where that is not available, as an IP is often
// placed in another city. Kept 30 min in place.json, shared by every session.
const PLACE = path.join(OUT_DIR, 'place.json')
const PLACE_MS = 30 * 60_000
const UA = { 'User-Agent': 'oficina-agentes (https://github.com/envyx10/oficina-agentes)' }
let place = null

function windowsLocation() {
  if (process.platform !== 'win32') return Promise.resolve(null)
  const script = [
    'Add-Type -AssemblyName System.Device',
    '$w = New-Object System.Device.Location.GeoCoordinateWatcher',
    '$null = $w.TryStart($false, [TimeSpan]::FromSeconds(8))',
    '$i = 0; while ($w.Status -ne "Ready" -and $i -lt 40) { Start-Sleep -Milliseconds 250; $i++ }',
    '$c = $w.Position.Location',
    'if (-not $c.IsUnknown) { "{0} {1}" -f $c.Latitude.ToString([cultureinfo]::InvariantCulture), $c.Longitude.ToString([cultureinfo]::InvariantCulture) }',
    '$w.Stop()',
  ].join('; ')
  return new Promise(resolve => {
    require('child_process').execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 25_000, windowsHide: true }, (err, stdout) => {
        const [lat, lon] = String(stdout || '').trim().split(/\s+/).map(Number)
        resolve(!err && Number.isFinite(lat) && Number.isFinite(lon) ? { latitude: lat, longitude: lon, source: 'windows' } : null)
      })
  })
}

async function getJson(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(String(res.status))
  return res.json()
}

async function ipLocation() {
  try {
    const j = await getJson('https://ipwho.is/')
    if (j.success && Number.isFinite(j.latitude)) return { latitude: j.latitude, longitude: j.longitude, name: j.city, source: 'ip' }
  } catch {}
  try {
    const j = await getJson('https://free.freeipapi.com/api/json')
    if (Number.isFinite(j.latitude)) return { latitude: j.latitude, longitude: j.longitude, name: j.cityName, source: 'ip' }
  } catch {}
  return null
}

// the town's name for a point, from OpenStreetMap
async function townAt(lat, lon) {
  try {
    const j = await getJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=es&lat=${lat}&lon=${lon}`)
    const a = j.address || {}
    return a.city || a.town || a.village || a.municipality || a.state_district || null
  } catch {
    return null
  }
}

async function locate() {
  try {
    const saved = JSON.parse(fs.readFileSync(PLACE, 'utf8'))
    if (Date.now() - saved.at < PLACE_MS) { place = saved; return }
  } catch {}
  const found = (await windowsLocation()) || (await ipLocation())
  if (!found) return
  const name = (await townAt(found.latitude, found.longitude)) || found.name
  if (!name) return
  place = { name, latitude: found.latitude, longitude: found.longitude, source: found.source, at: Date.now() }
  try { fs.mkdirSync(OUT_DIR, { recursive: true }); fs.writeFileSync(PLACE, JSON.stringify(place)) } catch {}
}

const once = process.argv.includes('--once')
const tick = () => process.stdout.write(JSON.stringify({ ...scan(), place }) + '\n')
tick()
saveCache()
if (!once) {
  locate().then(tick, () => {})
  setInterval(() => { locate().catch(() => {}) }, PLACE_MS)
  setInterval(tick, 2000)
  setInterval(saveCache, 30_000)
  // the mod kills this process when it unloads; also leave if the session's process is gone
  const parent = process.ppid
  setInterval(() => {
    try { process.kill(parent, 0) } catch { saveCache(); process.exit(0) }
  }, 10_000)
}
