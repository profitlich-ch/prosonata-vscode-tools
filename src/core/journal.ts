import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * `log.jsonl` (KONZEPT.md §7).
 *
 * A buffer, not an archive: what has reached ProSonata is kept there, and the
 * local line beside it proves nothing the entry does not prove better. Two jobs
 * remain — rebuilding pending writes if `state.json` is lost, and looking back
 * over the last few days when something went wrong.
 *
 * A line therefore has to carry everything needed to rebuild a pending write.
 * A bare note "segment finished" would be worthless for recovery.
 */

export interface JournalLine {
  at: string
  kind: 'segment' | 'commit' | 'sent' | 'note'
  entryId: string
  key?: string
  projectId?: number
  categoryId?: number
  seconds?: number
  date?: string
  text?: string
  sha?: string
  timeId?: number
  message?: string
}

/** Above this the file is trimmed, keeping the most recent part. */
const MAX_BYTES = 2 * 1024 * 1024
const KEEP_BYTES = 512 * 1024

export class Journal {
  constructor(private readonly file: string) {}

  append(line: Omit<JournalLine, 'at'> & { at?: string }): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const entry: JournalLine = { at: line.at ?? new Date().toISOString(), ...line } as JournalLine
    appendFileSync(this.file, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
    this.trimIfLarge()
  }

  read(): JournalLine[] {
    if (!existsSync(this.file)) return []
    return readFileSync(this.file, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as JournalLine]
        } catch {
          // A line torn by a crash costs us that line, not the file.
          return []
        }
      })
  }

  /**
   * Entries that were journalled but never confirmed as sent. This is what
   * recovery re-queues after `state.json` was lost.
   */
  unsent(): JournalLine[] {
    const sent = new Set(this.read().filter((line) => line.kind === 'sent').map((line) => line.entryId))
    const seen = new Map<string, JournalLine>()
    for (const line of this.read()) {
      if (line.kind === 'sent' || line.kind === 'note') continue
      if (sent.has(line.entryId)) continue
      seen.set(line.entryId, line)
    }
    return [...seen.values()]
  }

  /**
   * Keeps the newest part and drops the rest — but never a line about an entry
   * that is still waiting to be sent.
   */
  private trimIfLarge(): void {
    if (!existsSync(this.file) || statSync(this.file).size <= MAX_BYTES) return

    const lines = this.read()
    const unsent = new Set(this.unsent().map((line) => line.entryId))

    const kept: JournalLine[] = []
    let bytes = 0
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!
      const size = JSON.stringify(line).length + 1
      if (bytes + size > KEEP_BYTES && !unsent.has(line.entryId)) continue
      kept.unshift(line)
      bytes += size
    }

    const temp = `${this.file}.tmp-${process.pid}`
    writeFileSync(temp, kept.map((line) => `${JSON.stringify(line)}\n`).join(''), { mode: 0o600 })
    renameSync(temp, this.file)
  }
}
