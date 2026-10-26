import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'oficina-agentes',
  component: 'Pane',
  requestId: 'oficina',
  props: {
    title: 'Mi oficina',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const FLOOR = {
  id: 's1',
  name: 'API DE PAGOS',
  initials: 'AD',
  status: 'needs',
  activity: '¡Te necesito! OK para Bash',
  tokens: 62_800_000,
  costUsd: 12.1,
  startedAt: 1,
  changedAt: 1,
}

test('the pane draws the tower and the directory as one image, and a scroll reuses it', async ($, on) => {
  // Nothing sits beneath the plugin: these hooks stand for the engine.
  const clock = mock.clock(on)
  on('env.get', () => ({ value: 'C:/home' }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.read', () => ({ value: JSON.stringify(FLOOR) }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [{ name: 's1.json', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }))
  on('command.register', e => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'desktop') {
      const first = await ui.find({ type: 'Svg' })
      expect(first).toBeDefined()
      // the tower and the lobby directory are one plain image
      const drawn = JSON.stringify(first)
      expect(drawn).toContain('DIRECTORIO')
      expect(drawn).toContain('API DE PAGOS')
      expect(drawn).not.toContain('isInteractive')
      await ui.unmount()
      // the same pane scrolled 7 s later: the drawing's markup must not change
      await clock.advance(7_000)
      const scrolled = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, scroll: { offset: 12, bodyRows: 40 } } })
      const again = await scrolled.find({ type: 'Svg' })
      expect(JSON.stringify(again)).toBe(JSON.stringify(first))
      await scrolled.unmount()
    } else {
      expect(await ui.find({ type: 'Text', text: /API DE PAGOS/ })).toBeDefined()
      await ui.unmount()
    }
  }
})
