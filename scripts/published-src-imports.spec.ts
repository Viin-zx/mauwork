/**
 * Gate: a published package ships its built entry points, so a bare import of
 * another package's `src/` file only resolves in the source plane. The packaged
 * Host loads `lib/` from node_modules, where that path does not exist.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

/** Repository groups whose sources are never mounted from a published install. */
const SOURCE_PLANE_ONLY_PREFIXES = ['packages/test-support/']

interface PackageFacts {
  /** Workspace package name, for example `@deepseek-ai/dsh-llm-pi-ai`. */
  readonly name: string
  /** Repository-relative package directory with `/` separators. */
  readonly directory: string
  /** Whether the npm tarball carries the `src/` tree. */
  readonly shipsSources: boolean
}

/**
 * Read one workspace manifest.
 * @param directory - absolute package directory.
 * @returns package facts, or undefined for a directory without a named manifest.
 */
function packageFacts(directory: string): PackageFacts | undefined {
  const manifestPath = join(directory, 'package.json')
  if (!existsSync(manifestPath)) return undefined
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown; files?: unknown }
  if (typeof manifest.name !== 'string') return undefined
  const files = Array.isArray(manifest.files)
    ? manifest.files.filter((entry): entry is string => typeof entry === 'string')
    : []
  return {
    name: manifest.name,
    directory: relative(root, directory).replaceAll(sep, '/'),
    shipsSources: files.some(entry => entry === 'src' || entry.startsWith('src/')),
  }
}

/**
 * List every workspace package under `packages/*` and `vendor/*`.
 * @returns packages keyed by manifest name.
 */
function workspacePackages(): Map<string, PackageFacts> {
  const packages = new Map<string, PackageFacts>()
  const add = (directory: string): void => {
    const facts = packageFacts(directory)
    if (facts !== undefined) packages.set(facts.name, facts)
  }
  for (const group of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    for (const entry of readdirSync(join(root, 'packages', group.name), { withFileTypes: true })) {
      if (entry.isDirectory()) add(join(root, 'packages', group.name, entry.name))
    }
  }
  for (const entry of readdirSync(join(root, 'vendor'), { withFileTypes: true })) {
    if (entry.isDirectory()) add(join(root, 'vendor', entry.name))
  }
  return packages
}

/**
 * List TypeScript source files below one directory.
 * @param directory - absolute directory to walk.
 * @returns absolute file paths.
 */
function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) ? [path] : []
  })
}

/**
 * Extract module specifiers from static imports, type imports, re-exports, and
 * dynamic imports.
 * @param file - file name used to select the TypeScript script kind.
 * @param text - file contents.
 * @returns every imported or re-exported module specifier.
 */
export function moduleSpecifiers(file: string, text: string): string[] {
  const parsed = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    false,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const specifiers: string[] = []
  const push = (node: ts.Node | undefined): void => {
    if (node !== undefined && ts.isStringLiteralLike(node)) specifiers.push(node.text)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) push(node.moduleSpecifier)
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) push(node.argument.literal)
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) push(node.arguments[0])
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return specifiers
}

describe('published package sources', () => {
  it('extracts every module-bearing form', () => {
    const fixture = `
      import a from '@deepseek-ai/alpha/src/a.ts'
      import type { B } from '@deepseek-ai/beta/src/b.ts'
      export { c } from '@deepseek-ai/gamma/src/c.ts'
      export type { D } from '@deepseek-ai/delta/src/d.ts'
      import '@deepseek-ai/epsilon/src/e.ts'
      const f = await import('@deepseek-ai/zeta/src/f.ts')
      type G = import('@deepseek-ai/eta/src/g.ts').G
      import h from '@deepseek-ai/theta'
      import i from './local.ts'
    `
    expect(moduleSpecifiers('fixture.ts', fixture)).toEqual([
      '@deepseek-ai/alpha/src/a.ts',
      '@deepseek-ai/beta/src/b.ts',
      '@deepseek-ai/gamma/src/c.ts',
      '@deepseek-ai/delta/src/d.ts',
      '@deepseek-ai/epsilon/src/e.ts',
      '@deepseek-ai/zeta/src/f.ts',
      '@deepseek-ai/eta/src/g.ts',
      '@deepseek-ai/theta',
      './local.ts',
    ])
  })

  it('keeps built imports on package entry points', () => {
    const packages = workspacePackages()
    expect(packages.size).toBeGreaterThan(50)
    const violations: string[] = []
    let scanned = 0
    for (const importer of packages.values()) {
      if (SOURCE_PLANE_ONLY_PREFIXES.some(prefix => importer.directory.startsWith(prefix))) continue
      for (const file of sourceFiles(join(root, importer.directory, 'src'))) {
        scanned += 1
        for (const specifier of moduleSpecifiers(file, readFileSync(file, 'utf8'))) {
          const match = /^@deepseek-ai\/([^/]+)\/src(?:\/|$)/.exec(specifier)
          if (match === null) continue
          const target = packages.get(`@deepseek-ai/${match[1]}`)
          if (target !== undefined && !target.shipsSources) {
            violations.push(`${relative(root, file).replaceAll(sep, '/')}: imports ${specifier}`)
          }
        }
      }
    }
    expect(scanned).toBeGreaterThan(200)
    expect(violations).toEqual([])
  })
})
