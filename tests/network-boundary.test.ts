import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return productionSources(path)
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : []
  })
}

describe('production network boundary', () => {
  it('contains no direct network primitive in product source', () => {
    const matches = productionSources(join(root, 'src')).filter((path) =>
      /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/.test(readFileSync(path, 'utf8')),
    )
    expect(matches.map((path) => relative(root, path).replaceAll('\\', '/'))).toEqual([])
  })

  it('ships a same-origin-only connection policy', () => {
    const deployment = readFileSync(join(root, 'vercel.json'), 'utf8')
    expect(deployment).toContain("connect-src 'self'")
  })
})
