import { describe, expect, it } from 'vitest'
import {
  analyzeCsv,
  analyzeJson,
  csvToJson,
  detectFormat,
  formatJson,
  jsonToCsv,
  parseCsv,
  parseJson,
} from '../src/lib/data'

describe('JSON parsing', () => {
  it('parses and formats valid JSON', () => {
    const result = parseJson('{"name":"Lens","private":true}')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(formatJson(result.data)).toBe('{\n  "name": "Lens",\n  "private": true\n}')
  })

  it('reports a useful location for malformed JSON', () => {
    const result = parseJson('{\n  "name": "Lens",\n  broken\n}')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain('Invalid JSON')
    expect(result.error.line).toBe(3)
    expect(result.error.column).toBeGreaterThan(0)
  })

  it('reports empty JSON distinctly', () => {
    expect(parseJson('  \n ')).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'EMPTY_JSON' }),
    })
  })
})

describe('format detection', () => {
  it('uses extension and contents when they agree', () => {
    expect(detectFormat('people.json', '[{"name":"Ada"}]')).toMatchObject({
      format: 'json',
      extensionFormat: 'json',
      contentFormat: 'json',
      confidence: 'high',
    })
  })

  it('trusts recognizable contents over a misleading extension', () => {
    expect(detectFormat('people.txt', 'name,city\nAda,London')).toMatchObject({
      format: 'csv',
      extensionFormat: 'text',
      contentFormat: 'csv',
    })
  })

  it('retains the extension as a low-confidence hint for malformed content', () => {
    expect(detectFormat('broken.json', '{ nope')).toMatchObject({
      format: 'json',
      contentFormat: 'text',
      confidence: 'low',
    })
  })
})

describe('CSV parsing', () => {
  it('handles quoted delimiters, escaped quotes, and empty cells', () => {
    const result = parseCsv('name,note,city\nAda,"said ""hello, world""",London\nGrace,,New York')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.columns).toEqual(['name', 'note', 'city'])
    expect(result.data.rows).toEqual([
      { name: 'Ada', note: 'said "hello, world"', city: 'London' },
      { name: 'Grace', note: '', city: 'New York' },
    ])
  })

  it('records inconsistent row widths without crashing', () => {
    const result = parseCsv('a,b\n1,2,3\n4')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['TooManyFields', 'TooFewFields']),
    )
    expect(result.data.rows[1]).toEqual({ a: '4', b: '' })
  })

  it('reports duplicate headers after making them unique', () => {
    const result = parseCsv('name,name\nAda,Lovelace')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.columns).toEqual(['name', 'name_1'])
    expect(result.data.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'DUPLICATE_HEADER' }),
      ]),
    )
  })
})

describe('conversion', () => {
  it('converts parsed CSV to JSON while preserving empty strings', () => {
    const parsed = parseCsv('name,role\nAda,\nGrace,engineer')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(csvToJson(parsed.data)).toEqual([
      { name: 'Ada', role: '' },
      { name: 'Grace', role: 'engineer' },
    ])
  })

  it('can infer CSV numbers and booleans and control empty cells', () => {
    const parsed = parseCsv('name,score,active,note,id\nAda,9,true,,00123\nGrace,10.5,false,ready,9007199254740993')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(csvToJson(parsed.data, { inferTypes: true, emptyMode: 'null' })).toEqual([
      { name: 'Ada', score: 9, active: true, note: null, id: '00123' },
      { name: 'Grace', score: 10.5, active: false, note: 'ready', id: '9007199254740993' },
    ])
    expect(csvToJson(parsed.data, { emptyMode: 'omit' })[0]).toEqual({
      name: 'Ada', score: '9', active: 'true', id: '00123',
    })
  })

  it('converts heterogeneous JSON objects to correctly escaped CSV', () => {
    const result = jsonToCsv([
      { name: 'Ada', note: 'hello, world' },
      { name: 'Grace', active: true },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const parsed = parseCsv(result.data)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.columns).toEqual(['name', 'note', 'active'])
    expect(parsed.data.rows).toEqual([
      { name: 'Ada', note: 'hello, world', active: '' },
      { name: 'Grace', note: '', active: 'true' },
    ])
  })

  it('rejects JSON values that cannot become a table', () => {
    expect(jsonToCsv({ name: 'Ada' })).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'JSON_NOT_ARRAY' }),
    })
    expect(jsonToCsv([1, 2, 3])).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'JSON_ITEMS_NOT_OBJECTS' }),
    })
  })

  it('supports custom delimiters, line endings, and flattened objects', () => {
    const result = jsonToCsv(
      [{ name: 'Ada', profile: { active: true, score: 9 } }],
      { delimiter: ';', newline: '\r\n', nestedMode: 'flatten' },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toBe('name;profile.active;profile.score\r\nAda;true;9')
  })

  it('can expand nested arrays into repeated CSV rows', () => {
    const result = jsonToCsv(
      [{ user: { name: 'Ada' }, files: [{ name: 'one.pdf' }, { name: 'two.csv' }] }],
      { nestedMode: 'expand' },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const parsed = parseCsv(result.data)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.rows).toEqual([
      { 'user.name': 'Ada', 'files.name': 'one.pdf' },
      { 'user.name': 'Ada', 'files.name': 'two.csv' },
    ])
  })

  it('rejects flattening that would overwrite a column', () => {
    const result = jsonToCsv(
      [{ 'profile.name': 'original', profile: { name: 'nested' } }],
      { nestedMode: 'flatten' },
    )

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'FLATTEN_COLLISION' }),
    })
  })

  it('can protect spreadsheet formula-like string cells', () => {
    const result = jsonToCsv(
      [
        { value: '=SUM(A1:A2)' },
        { value: '@command' },
        { value: -4 },
      ],
      { protectFormulas: true },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const parsed = parseCsv(result.data)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.rows.map((row) => row.value)).toEqual([
      "'=SUM(A1:A2)",
      "'@command",
      '-4',
    ])
  })
})

describe('data insights', () => {
  it('infers CSV types and counts empties and duplicate rows', () => {
    const parsed = parseCsv('id,active,note\n1,true,\n2,false,ready\n2,false,ready')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(analyzeCsv(parsed.data)).toMatchObject({
      totalEmptyCells: 1,
      duplicateRows: 1,
      columns: [
        { name: 'id', type: 'number', emptyCount: 0, uniqueCount: 2 },
        { name: 'active', type: 'boolean', emptyCount: 0, uniqueCount: 2 },
        { name: 'note', type: 'text', emptyCount: 1, uniqueCount: 1 },
      ],
    })
  })

  it('summarizes JSON shape and depth', () => {
    expect(analyzeJson({ user: { name: 'Ada', tags: ['local', null] } })).toEqual({
      leafValues: 3,
      nullValues: 1,
      objects: 2,
      arrays: 1,
      maxDepth: 3,
    })
  })
})
