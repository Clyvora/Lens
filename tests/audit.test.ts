import { beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzeCsv, csvToJson, detectFormat, jsonToCsv, parseCsv } from '../src/lib/data'

describe('audit conversion regressions', () => {
  it('preserves prototype-like CSV headers and JSON keys', () => {
    const parsed = parseCsv('__proto__,toString,constructor\nkept,actual,yes')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(JSON.stringify(csvToJson(parsed.data))).toBe('[{"__proto__":"kept","toString":"actual","constructor":"yes"}]')
    expect(analyzeCsv(parsed.data).totalEmptyCells).toBe(0)
    for (const nestedMode of ['stringify', 'flatten', 'expand'] as const) {
      expect(jsonToCsv(JSON.parse('[{"__proto__":"kept","toString":"actual","x":1},{"x":2}]'), { nestedMode })).toEqual({ ok: true, data: '__proto__,toString,x\nkept,actual,1\n,,2' })
    }
  })
  it('protects headers and values without changing lookup keys', () => {
    expect(jsonToCsv([{ '=1+1': '@value' }], { protectFormulas: true })).toEqual({ ok: true, data: "'=1+1\n'@value" })
  })
  it('detects a 200000 row CSV within the size limit', () => {
    expect(detectFormat('large.csv', 'a,b\n' + '1,2\n'.repeat(200000)).format).toBe('csv')
  })
})

describe('audit worker regressions', () => {
  let handler: (event: { data: unknown }) => void
  let response: { data: any }
  beforeEach(async () => {
    vi.resetModules()
    vi.stubGlobal('self', { addEventListener: (_: string, callback: typeof handler) => { handler = callback }, postMessage: (value: typeof response) => { response = value } })
    await import('../src/workers/data.worker')
  })
  it('filters a column named all independently', () => {
    handler({ data: { id: 1, type: 'parse', filename: 'data.csv', content: 'all,other\nno,needle' } })
    handler({ data: { id: 2, type: 'queryCsv', query: 'needle', column: 'all', sort: null, limit: 100 } })
    expect(response.data.total).toBe(0)
    handler({ data: { id: 3, type: 'queryCsv', query: 'needle', column: null, sort: null, limit: 100 } })
    expect(response.data.total).toBe(1)
  })
  it('keeps dotted and nested table sources separate', () => {
    handler({ data: { id: 1, type: 'parse', filename: 'data.json', content: '[{"a.b":[{"v":"literal"}],"a":{"b":[{"v":"nested"}]}}]' } })
    expect(response.data.jsonTableSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '$[]["a.b"]', rows: 1 }),
      expect.objectContaining({ id: '$[].a.b', rows: 1 }),
    ]))
  })
})
