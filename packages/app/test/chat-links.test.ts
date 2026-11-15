import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '../src/renderer/components/atoms'
import { Markdown } from '../src/renderer/components/molecules/Markdown'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { areFiles } from '../src/main/file-viewer'
import { FileChecker, filePathIn, isShellLanguage, shellCommandOf } from '../src/renderer/lib/chatLinks'

describe('filePathIn', () => {
  it('reads paths with a folder, file names with an extension, and drops a line suffix', () => {
    expect(filePathIn('packages/app/src/main/index.ts')).toBe('packages/app/src/main/index.ts')
    expect(filePathIn('~/Desktop/notes.md')).toBe('~/Desktop/notes.md')
    expect(filePathIn('./scripts/run.sh')).toBe('./scripts/run.sh')
    expect(filePathIn('/etc/hosts')).toBe('/etc/hosts')
    expect(filePathIn('C:\\work\\acme\\README.md')).toBe('C:\\work\\acme\\README.md')
    expect(filePathIn('src/app.ts:42')).toBe('src/app.ts')
    expect(filePathIn('src/app.ts:42:7')).toBe('src/app.ts')
    expect(filePathIn('core/usecases/configuration.ts:228,348')).toBe('core/usecases/configuration.ts')
    expect(filePathIn('core/health/flow-history.ts:152-171')).toBe('core/health/flow-history.ts')
    expect(filePathIn('src/app.ts#L10-L20')).toBe('src/app.ts')
    expect(filePathIn('config.json')).toBe('config.json')
    expect(filePathIn('docs/')).toBe('docs')
  })

  it('leaves commands, versions, URLs, options and identifiers alone', () => {
    for (const code of ['npm run dev', '2.0.0-alpha.30', 'https://example.com/a.md', '--max-turns', 'useState', 'a && b', 'process.env', '$HOME/x', 'e.g', '']) {
      expect(filePathIn(code)).toBeNull()
    }
  })
})

describe('shell blocks', () => {
  it('knows the shell languages', () => {
    expect(isShellLanguage('language-bash')).toBe(true)
    expect(isShellLanguage('language-PowerShell')).toBe(true)
    expect(isShellLanguage('language-ts')).toBe(false)
    expect(isShellLanguage(undefined)).toBe(false)
  })

  it('types the commands without prompt marks, output or comments', () => {
    expect(shellCommandOf('npm ci\n# then\nnpm run dev\n')).toBe('npm ci\nnpm run dev')
    expect(shellCommandOf('$ git status\nOn branch main\n$ git log -1')).toBe('git status\ngit log -1')
    expect(shellCommandOf('PS C:\\acme> dir')).toBe('dir')
  })
})

describe('an agent reply with actions', () => {
  const text = 'Open `docs/guide.md` or [the notes](notes/today.md); `npm test` runs it.\n\n```bash\nnpm test\n```\n\n```ts\nconst a = 1\n```'
  const html = (actions?: Parameters<typeof Markdown>[0]['actions']) => renderToStaticMarkup(createElement(TooltipProvider, null, createElement(Markdown, { text, actions })))

  it('makes file paths open and shell blocks runnable', () => {
    const out = html({ openFile: () => undefined, runCommand: () => undefined })
    expect(out.match(/<button[^>]*title="Open [^"]+"/g)).toEqual(['<button type="button" class="cursor-pointer text-accent hover:underline" title="Open docs/guide.md"', '<button type="button" class="cursor-pointer text-accent hover:underline" title="Open notes/today.md"'])
    // One run button, for the bash block only.
    expect(out.match(/aria-label="Run in the Shell view"/g)).toHaveLength(1)
  })

  it('leaves everything as text without actions, and offers no run button without a shell', () => {
    const plain = html()
    expect(plain).not.toContain('title="Open')
    expect(plain).not.toContain('Run in the Shell view')
    expect(html({ openFile: () => undefined })).not.toContain('Run in the Shell view')
  })
})

describe('only real files become links', () => {
  it('asks the main process which paths are files, relative to the session folder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wh-links-'))
    try {
      mkdirSync(join(dir, 'docs'))
      writeFileSync(join(dir, 'docs', 'notes.md'), 'x')
      expect(await areFiles(['docs/notes.md', 'docs', 'feat/branch', join(dir, 'docs', 'notes.md'), 42], dir, dir)).toEqual([true, false, false, true, false])
      expect(await areFiles('nope', dir, dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('checks in one batch per folder, remembers files, and asks again about a miss later', async () => {
    let now = 0
    const asked: string[][] = []
    const checker = new FileChecker(async (paths) => (asked.push(paths), paths.map((p) => p.endsWith('.md'))), () => now, 1000, 0)
    expect(await Promise.all([checker.isFile('a.md', '/w'), checker.isFile('feat/x', '/w')])).toEqual([true, false])
    expect(asked).toEqual([['a.md', 'feat/x']])
    expect(checker.peek('a.md', '/w')).toBe(true)
    expect(checker.peek('feat/x', '/w')).toBe(false)
    now = 2000
    expect(checker.peek('a.md', '/w')).toBe(true)
    expect(checker.peek('feat/x', '/w')).toBeUndefined()
  })

  it('keeps a path that is not a file as plain code', () => {
    const out = renderToStaticMarkup(
      createElement(TooltipProvider, null, createElement(Markdown, { text: '`feat/branch` and `docs/notes.md`', actions: { openFile: () => undefined, isFile: { known: (p) => p === 'docs/notes.md', check: async () => false } } }))
    )
    expect(out).toContain('<code>feat/branch</code>')
    expect(out).toContain('title="Open docs/notes.md"')
    expect(out).not.toContain('title="Open feat/branch"')
  })
})
