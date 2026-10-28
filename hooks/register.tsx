import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Floor, FloorStatus, JiraState, TowerSnapshot, Weather } from '../types'
import { renderDirectory } from './directory'
import { formatTokens, renderTower } from './tower'

// Every Claude Code session on this machine is a floor: a scanner reads the
// transcripts, and each session that loads this mod also writes its own exact
// status to a shared folder (one JSON file per session).

const PANE = 'oficina'
const TITLE = 'Mi oficina'
const ALIVE_MS = 150_000
const REVIEW_TO_SLEEP_MS = 45 * 60_000
const POLL_MS = 3_000

const meAtom = atom({ plugin: 'oficina-agentes', key: 'me' } as const, null)
const floorsAtom = atom({ plugin: 'oficina-agentes', key: 'floors' } as const, [])
const weatherAtom = atom({ plugin: 'oficina-agentes', key: 'weather' } as const, null)
const historicAtom = atom({ plugin: 'oficina-agentes', key: 'historic' } as const, 0)
const tpmAtom = atom({ plugin: 'oficina-agentes', key: 'tpm' } as const, 0)
const towerAtom = atom({ plugin: 'oficina-agentes', key: 'tower' } as const, null)

type SessionRecord = Floor & { ended?: boolean; named?: boolean }

let dir = ''
let sessionId = ''
const fileCache = new Map<string, { mtimeMs: number; rec: SessionRecord }>()
let samples: { t: number; total: number }[] = []
const pendingAsks = new Set<string>()

const STATUS_COLOR: { [K in FloorStatus]: string } = {
  working: '#3b82f6',
  needs: '#ef4444',
  review: '#eab308',
  sleeping: '#64748b',
}

const STATUS_LABEL: { [K in FloorStatus]: string } = {
  working: 'trabajando',
  needs: 'te necesita',
  review: 'para revisar',
  sleeping: 'dormido',
}

// the directory lists the agents that need you first
const ORDER: { [K in FloorStatus]: number } = { needs: 0, working: 1, review: 2, sleeping: 3 }

function ago(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 1) return 'ahora'
  if (m < 60) return `hace ${m} min`
  const h = Math.floor(m / 60)
  return h < 24 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} d`
}

function nameFrom(text: string) {
  const words = text.replace(/[`*_#>\[\]()"']/g, ' ').trim().split(/\s+/).filter(Boolean)
  const name = words.slice(0, 4).join(' ').toUpperCase()
  return name.length > 0 ? name.slice(0, 24) : 'AGENTE'
}

function initialsOf(name: string) {
  const words = name.split(/[\s\-_/]+/).filter(w => /[A-ZÁÉÍÓÚÑ0-9]/i.test(w))
  const letters = words.slice(0, 2).map(w => w[0]).join('')
  return (letters || name.slice(0, 2)).toUpperCase()
}

function baseName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? 'agente'
}

// the hour in the city's time zone, so the sky turns with the city's day
function localHour(ms: number, timeZone: string | undefined) {
  try {
    const h = new Date(ms).toLocaleString('en-GB', { timeZone, hour: '2-digit', hour12: false })
    return Number(h) % 24
  } catch {
    return new Date(ms).getHours()
  }
}

function weatherLabel(code: number) {
  if (code === 0) return 'Despejado'
  if (code <= 2) return 'Poco nuboso'
  if (code === 3) return 'Nublado'
  if (code <= 48) return 'Niebla'
  if (code <= 67) return 'Lluvia'
  if (code <= 77) return 'Nieve'
  if (code <= 82) return 'Chubascos'
  return 'Tormenta'
}

// this session's own record; the atom (which redraws the pane) is written only
// when what the drawing reads of it changes, so a tool call does not redraw
let mine: SessionRecord | null = null

async function saveMe($: EngineInterface, patch: Partial<SessionRecord>) {
  const current = mine ?? ((await read($, meAtom)) as SessionRecord | null)
  if (!current) return
  const now = await $.clock.now()
  const next: SessionRecord = {
    ...current,
    ...patch,
    changedAt: patch.status !== undefined && patch.status !== current.status ? now : current.changedAt,
  }
  mine = next
  if (next.status !== current.status || next.name !== current.name || next.id !== current.id)
    await update($, meAtom, () => next)
  await $.fs.write(`${dir}/${sessionId}.json`, JSON.stringify(next))
}

type ScanSession = Floor & { project: string; subagents: number }
type ScanPlace = { name: string; latitude: number; longitude: number }
type ScanResult = { sessions: ScanSession[]; historic: number; at: number; place?: ScanPlace | null; jira?: JiraState | null }

let lastScan: ScanResult | null = null
const modRecords = new Map<string, SessionRecord>()
const TOWER_MS = 5 * 60_000
let lastShape = ''
// the drawing's markup, made again only when what it shows changes
let towerCache: { key: string; svg: string; width: number; height: number } | null = null

// the mod's own records: exact status of sessions that load this mod
async function readModRecords($: EngineInterface, now: number) {
  const entries = await $.fs.list(dir).catch(() => [])
  modRecords.clear()
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json') || entry.name === 'scan-cache.json') continue
    const path = `${dir}/${entry.name}`
    let cached = fileCache.get(path)
    if (!cached || cached.mtimeMs !== entry.mtimeMs) {
      const text = await $.fs.read(path).catch(() => '')
      try {
        cached = { mtimeMs: entry.mtimeMs, rec: JSON.parse(text) as SessionRecord }
        fileCache.set(path, cached)
      } catch {
        continue
      }
    }
    const rec = cached.rec
    if (!rec.id) continue
    const isAlive = !rec.ended && (rec.id === sessionId || now - entry.mtimeMs < ALIVE_MS)
    if (isAlive) modRecords.set(rec.id, rec)
  }
}

// every session on the machine, from the transcripts the scanner reads; a
// session that loads the mod answers its own status, which is exact
async function publish($: EngineInterface) {
  const now = await $.clock.now()
  const byId = new Map<string, Floor>()
  for (const s of lastScan?.sessions ?? []) {
    const name = s.name.toUpperCase().slice(0, 28)
    byId.set(s.id, { ...s, name, initials: initialsOf(name) })
  }
  for (const rec of modRecords.values()) {
    const scanned = byId.get(rec.id)
    const status: FloorStatus =
      rec.status === 'review' && now - rec.changedAt > REVIEW_TO_SLEEP_MS ? 'sleeping' : rec.status
    byId.set(rec.id, {
      ...(scanned ?? rec),
      id: rec.id,
      name: scanned?.name ?? rec.name,
      initials: scanned?.initials ?? rec.initials,
      status,
      activity: status === 'working' && scanned ? scanned.activity : rec.activity,
      tokens: Math.max(rec.tokens, scanned?.tokens ?? 0),
      costUsd: rec.costUsd > 0 ? rec.costUsd : scanned?.costUsd ?? 0,
      changedAt: Math.max(rec.changedAt, scanned?.changedAt ?? 0),
    })
  }
  const floors = [...byId.values()].sort((a, b) => a.startedAt - b.startedAt)
  const historic = lastScan?.historic ?? floors.reduce((n, f) => n + f.tokens, 0)

  samples = [...samples, { t: now, total: historic }].filter(s => now - s.t <= 5 * 60_000)
  const first = samples[0]
  const minutes = first ? (now - first.t) / 60_000 : 0
  const tpm = minutes > 0.25 && first ? Math.round((historic - first.total) / minutes) : 0

  // live values feed the native parts of the pane, which redraw without a flash
  if (JSON.stringify(await read($, floorsAtom)) !== JSON.stringify(floors)) await update($, floorsAtom, () => floors)
  if ((await read($, historicAtom)) !== historic) await update($, historicAtom, () => historic)
  const shown = await read($, tpmAtom)
  if (Math.abs(tpm - shown) > Math.max(50, shown * 0.05)) await update($, tpmAtom, () => tpm)

  // the drawing reloads whole whenever its markup changes, so its snapshot
  // moves only when a floor changes colour or an agent comes or goes, or every 5 min
  const jira = lastScan?.jira ?? null
  const shape = floors.map(f => `${f.id}:${f.status}:${f.name}:${Math.min(1, f.subagents ?? 0)}:${f.mr?.url ?? ''}`).join('|') +
    JSON.stringify(jira)
  const snapshot = await read($, towerAtom)
  if (shape !== lastShape || !snapshot || now - snapshot.at >= TOWER_MS) {
    const next: TowerSnapshot = { floors, historic, tpm, at: now, jira }
    await update($, towerAtom, () => next)
    lastShape = shape
  }
}

async function poll($: EngineInterface) {
  await readModRecords($, await $.clock.now())
  await publish($)
}

// a long-lived node process that watches ~/.claude/projects and prints a JSON line every 2 s
async function runScanner($: EngineInterface, city: string, env: Record<string, string>) {
  const script = `${$.plugin.root}/scanner/scan.cjs`
  for (const node of ['node', 'C:\\Program Files\\nodejs\\node.exe', '/usr/local/bin/node', '/opt/homebrew/bin/node']) {
    try {
      let buffer = ''
      for await (const piece of $.process.spawn({ argv: [node, script], env })) {
        if (piece.stream !== 'stdout') continue
        buffer += piece.text
        let cut = buffer.indexOf('\n')
        while (cut >= 0) {
          const line = buffer.slice(0, cut)
          buffer = buffer.slice(cut + 1)
          cut = buffer.indexOf('\n')
          try {
            lastScan = JSON.parse(line) as ScanResult
            await publish($)
            const place = lastScan.place
            if (!city && place && place.name !== weatherPlace) {
              weatherPlace = place.name
              void fetchWeather($, city)
            }
          } catch {
            // a line cut short: skip it
          }
        }
      }
      return
    } catch {
      // that node could not start: try the next
    }
  }
}

// a redraw reloads the drawing and SMIL starts every loop over; begin each one
// as far into its cycle as the wall clock says, so the car and the elevator
// carry on from where they were rather than jumping back
function syncToClock(svg: string, nowMs: number) {
  const seconds = nowMs / 1000
  return svg.replace(/<(animate|animateTransform)\b[^>]*>/g, tag => {
    const dur = /\bdur="([\d.]+)s"/.exec(tag)
    if (!dur || !tag.includes('repeatCount="indefinite"')) return tag
    const period = Number(dur[1])
    if (!(period > 0)) return tag
    const begin = /\bbegin="-([\d.]+)s"/.exec(tag)
    const offset = ((Number(begin?.[1] ?? 0) + seconds) % period).toFixed(3)
    return begin ? tag.replace(begin[0], `begin="-${offset}s"`) : tag.replace(/\s*\/?>$/, m => ` begin="-${offset}s"${m}`)
  })
}

// stacks SVG documents of one width into a single document, each nested at its offset
function stack(parts: { svg: string; width: number; height: number }[], gap: number) {
  const width = parts[0]?.width ?? 360
  let y = 0
  let body = ''
  for (const part of parts) {
    const root = /^<svg\b[^>]*>/.exec(part.svg)?.[0] ?? ''
    const crisp = root.includes('crispEdges') ? ' shape-rendering="crispEdges"' : ''
    const inner = part.svg.slice(root.length).replace(/<\/svg>\s*$/, '')
    body += `<svg x="0" y="${y}" width="${width}" height="${part.height}" viewBox="0 0 ${part.width} ${part.height}" overflow="hidden"${crisp}>${inner}</svg>`
    y += part.height + gap
  }
  const height = y - gap
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="xMidYMin meet" style="display:block">${body}</svg>`
  return { svg, width, height }
}

type Place = { latitude: number; longitude: number; name: string; timeZone?: string }

async function fetchJson<T>($: EngineInterface, url: string): Promise<T | undefined> {
  const res = await $.http.fetch(url).catch(() => undefined)
  if (!res?.ok) return undefined
  try {
    return JSON.parse(res.text) as T
  } catch {
    return undefined
  }
}

// where the weather is for: the city named in the options, found by Open-Meteo's
// geocoder; with none, where the scanner says this machine is (the system's own
// location, else its IP). The scanner asks on the machine's own network: asked
// from here, through the host, an IP lookup can place it in another city
let weatherPlace = ''

async function findPlace($: EngineInterface, city: string): Promise<Place | undefined> {
  if (!city) return lastScan?.place ?? undefined
  type Found = { results?: { latitude: number; longitude: number; name: string; timezone?: string }[] }
  const hit = (await fetchJson<Found>($, `https://geocoding-api.open-meteo.com/v1/search?count=1&language=es&name=${encodeURIComponent(city)}`))?.results?.[0]
  return hit ? { latitude: hit.latitude, longitude: hit.longitude, name: hit.name, timeZone: hit.timezone } : undefined
}

async function fetchWeather($: EngineInterface, city: string) {
  const place = await findPlace($, city)
  if (!place) return
  type Forecast = { timezone?: string; current?: { temperature_2m?: number; weather_code?: number } }
  const data = await fetchJson<Forecast>($,
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,weather_code&timezone=auto`)
  const c = data?.current
  if (c?.temperature_2m === undefined) return
  const weather: Weather = {
    tempC: c.temperature_2m,
    label: weatherLabel(c.weather_code ?? 0),
    city: place.name,
    timeZone: data?.timezone ?? place.timeZone,
  }
  if (JSON.stringify(await read($, weatherAtom)) !== JSON.stringify(weather)) await update($, weatherAtom, () => weather)
}

async function refreshCost($: EngineInterface) {
  const usage = await $.session.usage().catch(() => undefined)
  const usd = usage?.cost?.usd
  if (usd !== undefined) await saveMe($, { costUsd: usd })
}

export const register: Register = (on, options) => {
  const city = String(options.city ?? '').trim()
  // the Jira options go to the scanner, which asks Jira; the token stays in its environment
  const jiraEnv = {
    JIRA_SITE: String(options.jiraSite ?? ''),
    JIRA_EMAIL: String(options.jiraEmail ?? ''),
    JIRA_TOKEN: String(options.jiraToken ?? ''),
  }

  on('session.start', async ($, e, next) => {
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
    dir = `${home.replace(/\\/g, '/')}/.claude/oficina-agentes`
    sessionId = await $.session.id()
    samples = []

    const now = await $.clock.now()
    const saved = await $.fs
      .read(`${dir}/${sessionId}.json`)
      .then(text => JSON.parse(text) as SessionRecord)
      .catch(() => undefined)
    const held = (await read($, meAtom)) as SessionRecord | null
    const fallbackName = baseName(e.cwd).toUpperCase().slice(0, 24)
    // the file is written on every change, the atom only when the drawing needs it
    const me: SessionRecord = saved ?? held ?? {
      id: sessionId,
      name: fallbackName,
      initials: initialsOf(fallbackName),
      status: 'sleeping',
      activity: 'Esperando instrucciones',
      tokens: 0,
      costUsd: 0,
      startedAt: now,
      changedAt: now,
    }
    mine = { ...me, ended: false }
    await update($, meAtom, () => ({ ...me, ended: false }))
    await $.fs.write(`${dir}/${sessionId}.json`, JSON.stringify({ ...me, ended: false }))

    await $.command.register({ name: 'control', description: 'Abre el panel de Mi oficina de agentes de IA' })
    await $.command.register({ name: 'oficina', description: 'Abre el panel de Mi oficina de agentes de IA' })
    void $.ui.open({ id: PANE, title: TITLE, columns: 64 })

    await poll($)
    void runScanner($, city, jiraEnv)
    void fetchWeather($, city)
    $.clock.every(POLL_MS, () => void poll($))
    $.clock.every(60_000, () => void saveMe($, {}))
    $.clock.every(30 * 60_000, () => void fetchWeather($, city))

    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    void $.ui.open({ id: PANE, title: TITLE, columns: 64 })
    return next(e)
  })

  // /control and /oficina both open the pane
  on('command.run', { command: 'control' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, columns: 64 })
    return { text: 'Mi oficina abierta.' }
  })

  on('command.run', { command: 'oficina' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, columns: 64 })
    return { text: 'Mi oficina abierta.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const me = mine ?? ((await read($, meAtom)) as SessionRecord | null)
    if (me && !e.isMeta && !e.command) {
      const patch: Partial<SessionRecord> = { status: 'working', activity: 'Pensando…' }
      if (!me.named && e.text.trim().length > 0) {
        const name = nameFrom(e.text)
        Object.assign(patch, { name, initials: initialsOf(name), named: true })
      }
      await saveMe($, patch)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await saveMe($, { status: 'working', activity: 'Pensando…' })
    return next(e)
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    // auto mode's classifier answers most asks at once: only a wait that lasts means a person is needed
    const callId = e.tool_use_id
    if (e.agentId === undefined && verdict.decision === 'ask' && e.approver === 'person' && callId) {
      pendingAsks.add(callId)
      $.clock.after(1_500, () => {
        if (pendingAsks.delete(callId)) void saveMe($, { status: 'needs', activity: `¡Te necesito! OK para ${e.tool}` })
      })
    }
    return verdict
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    pendingAsks.delete(e.tool_use_id)
    if (e.agentId !== undefined) return next(e)
    const asks = e.tool === 'AskUserQuestion' || e.tool === 'ExitPlanMode'
    await saveMe($, asks
      ? { status: 'needs', activity: '¡Te necesito! Tengo una pregunta' }
      : { status: 'working', activity: `Usando ${e.tool}` })
    const result = await next(e)
    if (asks) await saveMe($, { status: 'working', activity: 'Sigo trabajando' })
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const usage = e.usage
    const me = mine ?? ((await read($, meAtom)) as SessionRecord | null)
    if (me) {
      const used = usage
        ? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)
        : 0
      const patch: Partial<SessionRecord> = { tokens: me.tokens + used }
      if (e.agentId === undefined)
        Object.assign(patch, e.reason === 'aborted'
          ? { status: 'sleeping', activity: 'Interrumpido' }
          : { status: 'review', activity: 'Terminado: revísalo' })
      await saveMe($, patch)
      await refreshCost($)
    }
    return result
  })

  on('session.end', async ($, e, next) => {
    await saveMe($, { ended: true }).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const floors = await read($, floorsAtom)
    const me = await read($, meAtom)
    const weather = await read($, weatherAtom)
    const historic = await read($, historicAtom)
    const tpm = await read($, tpmAtom)
    const now = await $.clock.now()
    const jira = (await read($, towerAtom))?.jira ?? null

    const count =(s: FloorStatus) => floors.filter(f => f.status === s).length
    const meId = me?.id ?? null

    const chips = (
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {(['working', 'needs', 'review', 'sleeping'] as const).map(s => (
          <Text key={`chip-${s}`} color={STATUS_COLOR[s]} bold>
            ● {count(s)} {s === 'needs' ? 'te necesitan' : s === 'sleeping' ? 'dormidos' : STATUS_LABEL[s]}
          </Text>
        ))}
        <Text dimColor>
          ☁ {weather ? `${weather.label} · ${Math.round(weather.tempC)}° · ${weather.city ?? ''}` : 'Buscando el tiempo…'}
        </Text>
      </Box>
    )

    const reviewButton = me?.status === 'review' ? (
      <Button
        key="reviewed"
        label="✓ Marcar como revisado"
        onPress={() => void saveMe($, { status: 'sleeping', activity: 'Revisado' })}
      />
    ) : null

    // the terminal has no drawing: there the directory is plain rows
    const rows = [...floors].sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.changedAt - a.changedAt)
    const textDirectory = (
      <Box flexDirection="column">
        {rows.map(f => (
          <Box key={`row-${f.id}`} flexDirection="row" gap={1}>
            <Text color={STATUS_COLOR[f.status]}>●</Text>
            <Text bold={f.id === meId}>{f.name}</Text>
            <Text dimColor>{STATUS_LABEL[f.status]} · {f.activity} · {formatTokens(f.tokens)} · ${f.costUsd.toFixed(2)}{f.mr ? ` · MR ${f.mr.label}` : ''}</Text>
          </Box>
        ))}
        {jira ? (
          <Box flexDirection="column">
            <Text bold color="#a78bfa">JIRA · mis tickets</Text>
            {jira.error ? <Text dimColor>{jira.error}</Text> : null}
            {jira.tickets.map(t => (
              <Text key={`jira-${t.key}`}>{t.key} {t.summary} <Text dimColor>[{t.status}]</Text></Text>
            ))}
          </Box>
        ) : null}
      </Box>
    )

    if (e.surface !== 'terminal' && 'Svg' in table) {
      const Svg = table.Svg
      // the body's width in cells, at roughly 7.4 CSS pixels per cell on the app's panel
      const pixelWidth = Math.max(280, Math.min(900, Math.round((e.props.bodyColumns ?? 60) * 7.4)))
      const snapshot = (await read($, towerAtom)) ?? { floors, historic, tpm, at: now }
      const hour = localHour(snapshot.at, weather?.timeZone)
      const key = JSON.stringify([snapshot, weather, meId, hour])
      // a scroll, a click or a live counter redraws the pane: hand back the very
      // same markup then, so the drawing is not drawn again; it is drawn as a plain
      // image (no isInteractive): a new one replaces it without the flash of a
      // frame reloading, and its SMIL animations still run
      if (towerCache?.key !== key) {
        const recent = [...snapshot.floors]
          .filter(f => (f.status === 'review' || f.status === 'needs') && snapshot.at - f.changedAt < 15 * 60_000)
          .sort((a, b) => b.changedAt - a.changedAt)[0]
        const latest = recent
          ? recent.status === 'needs' ? `NUEVO · ${recent.name} te necesita` : `NUEVO · Terminado: ${recent.name}`
          : null
        const tower = renderTower({ floors: snapshot.floors, meId, weather, historic: snapshot.historic, tpm: snapshot.tpm, hour, latest })
        const lobby = renderDirectory({ floors: snapshot.floors, meId, now: snapshot.at, jira: snapshot.jira })
        // one drawing: the tower with the lobby directory beneath it
        const scene = stack([tower, lobby], 10)
        towerCache = { key, svg: syncToClock(scene.svg, now), width: scene.width, height: scene.height }
      }
      return (
        <Box flexDirection="column" gap={1}>
          {chips}
          {reviewButton}
          <Svg
            key="tower"
            source={towerCache.svg}
            width={pixelWidth}
            height={Math.round((pixelWidth * towerCache.height) / towerCache.width)}
            alt={`Rascacielos con ${floors.length} agentes: ${count('working')} trabajando, ${count('needs')} te necesitan, ${count('review')} para revisar`}
          />
          <Text mono size="caption" color="#7dd3fc">
            CENTRO DE DATOS · {Math.floor(historic).toLocaleString('es-ES')} tokens · +{tpm.toLocaleString('es-ES')}/min
          </Text>
        </Box>
      )
    }

    // terminal: the directory alone
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold color="#a78bfa">MI OFICINA DE AGENTES DE IA</Text>
        {chips}
        <Text color="#7dd3fc">Tokens: {Math.floor(historic).toLocaleString('es-ES')} · +{tpm}/min</Text>
        {reviewButton}
        {textDirectory}
      </Box>
    )
  })
}
