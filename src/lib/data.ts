import Papa from 'papaparse'

export type DataFormat = 'json' | 'csv' | 'text' | 'unknown'

export type JsonPrimitive = string | number | boolean | null
export type JsonObject = { [key: string]: JsonValue }
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]

export interface ParseIssue {
  message: string
  line?: number
  column?: number
  row?: number
  code?: string
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: ParseIssue }

export interface FormatDetection {
  format: DataFormat
  extensionFormat: DataFormat
  contentFormat: DataFormat
  confidence: 'high' | 'medium' | 'low'
}

export interface CsvDocument {
  columns: string[]
  rows: Array<Record<string, string>>
  errors: ParseIssue[]
}

export type CsvDelimiter = ',' | ';' | '\t'
export type CsvLineEnding = '\n' | '\r\n'
export type NestedJsonMode = 'stringify' | 'flatten' | 'expand'
export type CsvEmptyMode = 'empty' | 'null' | 'omit'

export interface CsvToJsonOptions {
  inferTypes?: boolean
  emptyMode?: CsvEmptyMode
}

export interface JsonToCsvOptions {
  delimiter?: CsvDelimiter
  newline?: CsvLineEnding
  nestedMode?: NestedJsonMode
  protectFormulas?: boolean
}

export type InferredColumnType = 'text' | 'number' | 'boolean' | 'date' | 'empty' | 'mixed'

export interface CsvColumnInsight {
  name: string
  type: InferredColumnType
  emptyCount: number
  uniqueCount: number
}

export interface CsvInsights {
  columns: CsvColumnInsight[]
  totalEmptyCells: number
  duplicateRows: number
}

export interface JsonInsights {
  leafValues: number
  nullValues: number
  objects: number
  arrays: number
  maxDepth: number
}

const EXTENSION_FORMATS: Record<string, DataFormat> = {
  csv: 'csv',
  json: 'json',
  txt: 'text',
}

function extensionFormat(filename: string): DataFormat {
  const dot = filename.lastIndexOf('.')
  if (dot < 0 || dot === filename.length - 1) return 'unknown'
  return EXTENSION_FORMATS[filename.slice(dot + 1).toLowerCase()] ?? 'unknown'
}

function looksLikeJson(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed || !'[{'.includes(trimmed[0])) return false

  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

function looksLikeCsv(content: string): boolean {
  if (!content.trim()) return false

  const result = Papa.parse<string[]>(content, {
    skipEmptyLines: 'greedy',
  })
  const rows = result.data
  if (rows.length === 0) return false

  const width = Math.max(...rows.map((row) => row.length))
  if (width < 2) return false

  // A single delimiter can be prose punctuation. Multiple records, or at
  // least two delimiters on one record, is stronger evidence of tabular data.
  return rows.length > 1 || rows[0].length > 2
}

function contentFormat(content: string): DataFormat {
  if (!content.trim()) return 'unknown'
  if (looksLikeJson(content)) return 'json'
  if (looksLikeCsv(content)) return 'csv'
  return 'text'
}

export function detectFormat(filename: string, content: string): FormatDetection {
  const fromExtension = extensionFormat(filename)
  const fromContent = contentFormat(content)

  if (fromContent !== 'unknown' && fromExtension === fromContent) {
    return {
      format: fromContent,
      extensionFormat: fromExtension,
      contentFormat: fromContent,
      confidence: 'high',
    }
  }

  if (fromContent === 'json' || fromContent === 'csv') {
    return {
      format: fromContent,
      extensionFormat: fromExtension,
      contentFormat: fromContent,
      confidence: fromExtension === 'unknown' || fromExtension === 'text' ? 'high' : 'medium',
    }
  }

  if (fromExtension === 'json' || fromExtension === 'csv') {
    return {
      format: fromExtension,
      extensionFormat: fromExtension,
      contentFormat: fromContent,
      confidence: 'low',
    }
  }

  const format = fromContent === 'unknown' ? fromExtension : fromContent
  return {
    format,
    extensionFormat: fromExtension,
    contentFormat: fromContent,
    confidence: format === 'unknown' ? 'low' : 'medium',
  }
}

function positionToLocation(content: string, position: number): Pick<ParseIssue, 'line' | 'column'> {
  const beforeError = content.slice(0, Math.max(0, position))
  const lines = beforeError.split(/\r\n|\n|\r/)
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  }
}

function jsonParseIssue(content: string, error: unknown): ParseIssue {
  const originalMessage = error instanceof Error ? error.message : 'Invalid JSON.'
  const positionMatch = originalMessage.match(/(?:at position|position)\s+(\d+)/i)
  const lineColumnMatch = originalMessage.match(/line\s+(\d+)\s+column\s+(\d+)/i)

  let line: number | undefined
  let column: number | undefined

  if (lineColumnMatch) {
    line = Number(lineColumnMatch[1])
    column = Number(lineColumnMatch[2])
  } else if (positionMatch) {
    ;({ line, column } = positionToLocation(content, Number(positionMatch[1])))
  }

  const location = line && column ? ` at line ${line}, column ${column}` : ''
  return {
    message: `Invalid JSON${location}. ${originalMessage}`,
    line,
    column,
    code: 'INVALID_JSON',
  }
}

export function parseJson(content: string): Result<JsonValue> {
  if (!content.trim()) {
    return {
      ok: false,
      error: {
        message: 'The JSON file is empty.',
        line: 1,
        column: 1,
        code: 'EMPTY_JSON',
      },
    }
  }

  try {
    return { ok: true, data: JSON.parse(content) as JsonValue }
  } catch (error) {
    return { ok: false, error: jsonParseIssue(content, error) }
  }
}

export function formatJson(value: JsonValue, spaces = 2): string {
  return JSON.stringify(value, null, spaces)
}

function csvIssue(error: Papa.ParseError): ParseIssue {
  return {
    message: error.message,
    row: typeof error.row === 'number' ? error.row + 1 : undefined,
    code: error.code,
  }
}

export function parseCsv(content: string): Result<CsvDocument> {
  if (!content.trim()) {
    return {
      ok: false,
      error: { message: 'The CSV file is empty.', code: 'EMPTY_CSV' },
    }
  }

  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  })

  const columns = parsed.meta.fields ?? []
  const errors = parsed.errors.map(csvIssue)
  for (const [renamed, original] of Object.entries(parsed.meta.renamedHeaders ?? {})) {
    errors.push({
      message: `Duplicate header “${original}” was renamed to “${renamed}”.`,
      code: 'DUPLICATE_HEADER',
    })
  }
  const fatalError = parsed.errors.find((error) => error.type === 'Quotes')

  if (fatalError) {
    return { ok: false, error: csvIssue(fatalError) }
  }

  if (columns.length === 0) {
    return {
      ok: false,
      error: { message: 'No CSV columns could be found.', code: 'NO_COLUMNS' },
    }
  }

  const rows = parsed.data.map((row) => {
    const normalized: Record<string, string> = {}
    for (const column of columns) {
      const value = row[column]
      normalized[column] = value == null ? '' : String(value)
    }
    return normalized
  })

  return { ok: true, data: { columns, rows, errors } }
}

const OMIT_CELL = Symbol('omit-cell')

function typedCsvCell(value: string, options: CsvToJsonOptions): JsonPrimitive | typeof OMIT_CELL {
  const trimmed = value.trim()
  if (!trimmed) {
    if (options.emptyMode === 'null') return null
    if (options.emptyMode === 'omit') return OMIT_CELL
    return ''
  }
  if (!options.inferTypes) return value
  if (/^(?:true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true'
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed) && Number.isFinite(Number(trimmed))) {
    const number = Number(trimmed)
    const unsigned = trimmed.replace(/^[-+]/, '')
    const hasSignificantLeadingZero = /^0\d/.test(unsigned)
    const unsafeInteger = Number.isInteger(number) && !Number.isSafeInteger(number)
    if (!hasSignificantLeadingZero && !unsafeInteger) return number
  }
  return value
}

export function csvToJson(
  csvData: CsvDocument,
  options: CsvToJsonOptions = {},
): JsonObject[] {
  return csvData.rows.map((row) => {
    const item: JsonObject = {}
    for (const column of csvData.columns) {
      const value = typedCsvCell(row[column] ?? '', options)
      if (value !== OMIT_CELL) item[column] = value
    }
    return item
  })
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function csvCell(
  value: JsonValue | undefined,
  protectFormulas = false,
): string | number | boolean | null {
  if (value == null) return null
  if (typeof value === 'object') return JSON.stringify(value)
  if (
    protectFormulas &&
    typeof value === 'string' &&
    /^[\t\r ]*[=+\-@]/.test(value)
  ) return `'${value}`
  return value
}

function assignUnique(target: JsonObject, key: string, value: JsonValue) {
  if (Object.hasOwn(target, key)) {
    throw new Error(`Flattening creates the duplicate column “${key}”. Rename the conflicting JSON key or keep nested values as JSON text.`)
  }
  target[key] = value
}

function flattenJsonObject(value: JsonObject, prefix = ''): JsonObject {
  const flattened: JsonObject = {}
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isJsonObject(child)) {
      const nested = flattenJsonObject(child, path)
      for (const [nestedKey, nestedValue] of Object.entries(nested)) {
        assignUnique(flattened, nestedKey, nestedValue)
      }
    } else assignUnique(flattened, path, child)
  }
  return flattened
}

function mergeExpandedRows(left: JsonObject[], right: JsonObject[]): JsonObject[] {
  if (left.length * right.length > 1_000_000) {
    throw new Error('Expanding these nested arrays would create more than 1,000,000 rows. Choose a narrower table source or keep arrays as JSON text.')
  }
  const merged: JsonObject[] = []
  for (const leftRow of left) {
    for (const rightRow of right) {
      const next = { ...leftRow }
      for (const [key, value] of Object.entries(rightRow)) assignUnique(next, key, value)
      merged.push(next)
    }
  }
  return merged
}

function expandJsonObject(value: JsonObject, prefix = ''): JsonObject[] {
  let rows: JsonObject[] = [{}]
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    let variants: JsonObject[]
    if (isJsonObject(child)) {
      variants = expandJsonObject(child, path)
    } else if (Array.isArray(child)) {
      if (child.length === 0) variants = [{ [path]: null }]
      else {
        variants = child.flatMap((item) =>
          isJsonObject(item)
            ? expandJsonObject(item, path)
            : [{ [path]: item }],
        )
      }
    } else variants = [{ [path]: child }]
    rows = mergeExpandedRows(rows, variants)
  }
  return rows
}

export function jsonToCsv(jsonValue: JsonValue, options: JsonToCsvOptions = {}): Result<string> {
  if (!Array.isArray(jsonValue)) {
    return {
      ok: false,
      error: {
        message: 'JSON to CSV conversion requires an array of objects.',
        code: 'JSON_NOT_ARRAY',
      },
    }
  }

  if (!jsonValue.every(isJsonObject)) {
    return {
      ok: false,
      error: {
        message: 'Every item in the JSON array must be an object.',
        code: 'JSON_ITEMS_NOT_OBJECTS',
      },
    }
  }

  if (jsonValue.length === 0) return { ok: true, data: '' }

  let objects: JsonObject[]
  try {
    objects = options.nestedMode === 'expand'
      ? jsonValue.flatMap((item) => expandJsonObject(item))
      : options.nestedMode === 'flatten'
        ? jsonValue.map((item) => flattenJsonObject(item))
        : jsonValue
  } catch (error) {
    return {
      ok: false,
      error: {
        message: error instanceof Error ? error.message : 'Nested JSON could not be flattened safely.',
        code: 'FLATTEN_COLLISION',
      },
    }
  }
  const columns = Array.from(new Set(objects.flatMap((item) => Object.keys(item))))
  const rows = objects.map((item) =>
    columns.map((column) => csvCell(item[column], options.protectFormulas)),
  )

  return {
    ok: true,
    data: Papa.unparse(
      { fields: columns, data: rows },
      { delimiter: options.delimiter ?? ',', newline: options.newline ?? '\n' },
    ),
  }
}

export function getItemCount(value: JsonValue): number {
  if (Array.isArray(value)) return value.length
  if (isJsonObject(value)) return Object.keys(value).length
  return 1
}

function inferType(values: string[]): InferredColumnType {
  const present = values.map((value) => value.trim()).filter(Boolean)
  if (!present.length) return 'empty'
  const checks = [
    present.every((value) => /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(value) && Number.isFinite(Number(value))) ? 'number' : null,
    present.every((value) => /^(?:true|false)$/i.test(value)) ? 'boolean' : null,
    present.every((value) => /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(value) && !Number.isNaN(Date.parse(value))) ? 'date' : null,
  ].filter(Boolean) as InferredColumnType[]
  if (checks.length === 1) return checks[0]
  const kinds = new Set(present.map((value) => {
    if (/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(value)) return 'number'
    if (/^(?:true|false)$/i.test(value)) return 'boolean'
    return 'text'
  }))
  return kinds.size > 1 ? 'mixed' : 'text'
}

export function analyzeCsv(csvData: CsvDocument): CsvInsights {
  const signatures = new Set<string>()
  let duplicateRows = 0
  for (const row of csvData.rows) {
    const signature = JSON.stringify(csvData.columns.map((column) => row[column] ?? ''))
    if (signatures.has(signature)) duplicateRows += 1
    else signatures.add(signature)
  }
  const columns = csvData.columns.map((name) => {
    const values = csvData.rows.map((row) => row[name] ?? '')
    return {
      name,
      type: inferType(values),
      emptyCount: values.filter((value) => value.trim() === '').length,
      uniqueCount: new Set(values.filter((value) => value.trim() !== '')).size,
    }
  })
  return {
    columns,
    totalEmptyCells: columns.reduce((total, column) => total + column.emptyCount, 0),
    duplicateRows,
  }
}

export function analyzeJson(value: JsonValue): JsonInsights {
  const insights: JsonInsights = { leafValues: 0, nullValues: 0, objects: 0, arrays: 0, maxDepth: 0 }
  const visit = (node: JsonValue, depth: number) => {
    insights.maxDepth = Math.max(insights.maxDepth, depth)
    if (node === null) { insights.nullValues += 1; insights.leafValues += 1; return }
    if (Array.isArray(node)) { insights.arrays += 1; node.forEach((child) => visit(child, depth + 1)); return }
    if (typeof node === 'object') { insights.objects += 1; Object.values(node).forEach((child) => visit(child, depth + 1)); return }
    insights.leafValues += 1
  }
  visit(value, 0)
  return insights
}
