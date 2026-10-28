import { expect, test } from 'claude-code/testing'

import { renderDirectory } from '../hooks/directory'

const FLOOR = {
  id: 's1', name: 'API DE PAGOS', initials: 'AD', status: 'working' as const, activity: 'Editando a.ts',
  tokens: 10, costUsd: 1, startedAt: 1, changedAt: 1, project: 'api',
}

test('the directory shows the merge request of a floor and the Jira tickets', async () => {
  const mr = { url: 'https://gitlab.com/g/p/-/merge_requests/42', label: '!42' }
  const jira = { tickets: [{ key: 'CAES-12', summary: 'Arreglar el login', status: 'En curso' }] }
  const { svg, height } = renderDirectory({ floors: [{ ...FLOOR, mr }], meId: null, now: 2, jira })
  expect(svg).toContain('MR !42')
  expect(svg).toContain('CAES-12')
  expect(svg).toContain('EN CURSO')
  expect(height).toBeGreaterThan(renderDirectory({ floors: [FLOOR], meId: null, now: 2 }).height)
})

test('without Jira set up there is no ticket section, and a Jira error is shown', async () => {
  expect(renderDirectory({ floors: [FLOOR], meId: null, now: 2, jira: null }).svg).not.toContain('JIRA')
  const failed = renderDirectory({ floors: [FLOOR], meId: null, now: 2, jira: { tickets: [], error: 'Jira: error HTTP 401' } })
  expect(failed.svg).toContain('HTTP 401')
})
