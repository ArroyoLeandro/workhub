/**
 * What in an agent's reply can be acted on: a file path written as inline code (opened in
 * Workhub's file viewer) and a shell code block (run in the session's Shell view).
 */

/** A trailing place in a file as agents write it: `:12`, `:12:3`, `:12-20`, `:228,348`, `#L12-L20`. */
const LINE_SUFFIX = /(?::\d+(?:[-,]\d+)*(?::\d+)?|#L\d+(?:-L?\d+)?)$/

/**
 * The file a piece of inline code names, without its `:line` suffix; null when it does not look
 * like a path. A path has a folder (`src/app.ts`, `~/notes.md`, `./x`, `C:\dir\file`) or is a
 * bare file name with an extension that has a letter (`config.json`, not `2.0.1`). URLs, text
 * with spaces and options (`--flag`) are not paths.
 */
export function filePathIn(code: string): string | null {
  const text = code.trim()
  if (!text || text.length > 400 || /\s/.test(text) || text.includes('://') || text.startsWith('-')) return null
  const path = text.replace(LINE_SUFFIX, '')
  if (!path || /[<>|"*?`$;&(){}]/.test(path)) return null
  const hasFolder = /^(~|\.{1,2})?[\\/]/.test(path) || /^[A-Za-z]:[\\/]/.test(path) || /^[\w.@-]+[\\/]/.test(path)
  if (hasFolder) return path.endsWith('/') || path.endsWith('\\') ? path.slice(0, -1) || path : path
  const ext = /^[\w@-][\w.@-]*\.([A-Za-z][\w]{0,9})$/.exec(path)?.[1]?.toLowerCase()
  return ext && FILE_EXTENSIONS.has(ext) ? path : null
}

/**
 * Extensions a bare file name needs to count as a file: without a folder, `index.ts` is a file but
 * `process.env` or `item.text` are code.
 */
const FILE_EXTENSIONS = new Set(
  'md mdx txt log csv tsv pdf json jsonl yml yaml toml ini cfg conf xml html htm css scss sass less ts tsx mts cts js jsx mjs cjs py rb go rs java kt kts swift cs fs vb php c h cc cpp hpp m mm sh bash zsh fish ps1 bat cmd sql graphql gql proto lock png jpg jpeg gif webp svg ico mp4 mov zip tar gz plist dockerfile tf hcl vue svelte astro'.split(' ')
)

const SHELL_LANGUAGES = new Set(['sh', 'bash', 'zsh', 'shell', 'console', 'shellsession', 'powershell', 'pwsh', 'ps1', 'cmd', 'bat'])

/** Whether a fenced block's language (`language-bash`) is a shell one. */
export function isShellLanguage(className: string | undefined): boolean {
  const lang = /(?:^|\s)language-([\w-]+)/.exec(className ?? '')?.[1]?.toLowerCase()
  return lang !== undefined && SHELL_LANGUAGES.has(lang)
}

/**
 * The command of a shell block, as it should be typed: prompt marks (`$ `, `> `, `PS> `) are
 * dropped, and output lines of a `console` transcript (lines without a prompt when some have one)
 * are left out. Comments and blank lines stay out too.
 */
export function shellCommandOf(block: string): string {
  const lines = block.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n')
  const PROMPT = /^\s*(?:\$|>|PS[^>]*>|%)\s+/
  const prompted = lines.some((l) => PROMPT.test(l))
  return lines
    .filter((l) => (prompted ? PROMPT.test(l) : true))
    .map((l) => l.replace(PROMPT, ''))
    .filter((l) => l.trim() !== '' && !/^\s*#(?!!)/.test(l))
    .join('\n')
}

/**
 * Whether paths are files, asked of the main process in batches and remembered: a path that looks
 * like a file but is not one (a branch `feat/x`, a route `/api/users`) stays plain text. A file
 * found stays known; a miss is asked again after a while (the agent may create it later).
 */
export class FileChecker {
  private readonly known = new Map<string, { file: boolean; at: number }>()
  private queue = new Map<string, { path: string; cwd: string; done: ((file: boolean) => void)[] }>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly ask: (paths: string[], cwd: string) => Promise<boolean[]>,
    private readonly now: () => number = Date.now,
    private readonly missTtlMs = 30_000,
    private readonly batchMs = 30
  ) {}

  /** The answer already known, if any. */
  peek(path: string, cwd: string): boolean | undefined {
    const k = this.known.get(`${cwd}\0${path}`)
    if (!k || (!k.file && this.now() - k.at > this.missTtlMs)) return undefined
    return k.file
  }

  isFile(path: string, cwd: string): Promise<boolean> {
    const seen = this.peek(path, cwd)
    if (seen !== undefined) return Promise.resolve(seen)
    return new Promise((done) => {
      const key = `${cwd}\0${path}`
      const entry = this.queue.get(key) ?? { path, cwd, done: [] }
      entry.done.push(done)
      this.queue.set(key, entry)
      this.timer ??= setTimeout(() => void this.flush(), this.batchMs)
    })
  }

  private async flush(): Promise<void> {
    this.timer = null
    const batch = [...this.queue.values()]
    this.queue = new Map()
    const byCwd = new Map<string, typeof batch>()
    for (const e of batch) byCwd.set(e.cwd, [...(byCwd.get(e.cwd) ?? []), e])
    await Promise.all(
      [...byCwd].map(async ([cwd, entries]) => {
        const answers = await this.ask(
          entries.map((e) => e.path),
          cwd
        ).catch(() => entries.map(() => false))
        entries.forEach((e, i) => {
          const file = answers[i] === true
          this.known.set(`${cwd}\0${e.path}`, { file, at: this.now() })
          e.done.forEach((d) => d(file))
        })
      })
    )
  }
}
