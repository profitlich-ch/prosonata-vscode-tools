import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import de from '../../l10n/bundle.l10n.de.json'
import { baseLanguage, languageFor, setLanguage, t, template } from './l10n.js'

/** Every `t('…')` and `template('…')` in the sources, unescaped. */
function messagesInSources(): Map<string, string> {
  const found = new Map<string, string>()
  const call = /\b(?:t|template)\(\s*(['"])((?:\\.|(?!\1).)*)\1/g
  for (const file of sourceFiles(join(__dirname, '..'))) {
    for (const match of readFileSync(file, 'utf8').matchAll(call)) {
      found.set(unescape(match[2] ?? ''), file)
    }
  }
  return found
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = join(dir, item.name)
    if (item.isDirectory()) return sourceFiles(path)
    return item.name.endsWith('.ts') && !item.name.endsWith('.test.ts') ? [path] : []
  })
}

function unescape(literal: string): string {
  return literal.replace(/\\(.)/g, (_, char: string) => (char === 'n' ? '\n' : char))
}

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort()
}

const bundle = de as Record<string, string>

describe('German bundle', () => {
  it('has a translation for every visible text', () => {
    const missing = [...messagesInSources()].filter(([message]) => !(message in bundle))
    expect(missing.map(([message, file]) => `${file}: ${message}`)).toEqual([])
  })

  it('holds no translation that nothing uses any more', () => {
    const used = messagesInSources()
    expect(Object.keys(bundle).filter((message) => !used.has(message))).toEqual([])
  })

  it('keeps the placeholders of every message', () => {
    const changed = Object.entries(bundle).filter(([message, german]) => {
      return placeholders(message).join() !== placeholders(german).join()
    })
    expect(changed).toEqual([])
  })
})

describe('language', () => {
  afterEach(() => setLanguage(undefined))

  it('speaks German for any German locale', () => {
    expect(['de', 'de-CH', 'de_CH.UTF-8'].map(baseLanguage)).toEqual(['de', 'de', 'de'])
  })

  it('takes the environment before what the extension remembered', () => {
    expect(languageFor({ LANG: 'de_CH.UTF-8' }, 'en')).toBe('de_CH.UTF-8')
    expect(languageFor({ LC_ALL: 'en_US.UTF-8', LANG: 'de_CH.UTF-8' }, undefined)).toBe('en_US.UTF-8')
  })

  it('falls back to the remembered language when the locale names none', () => {
    expect(languageFor({}, 'de')).toBe('de')
    expect(languageFor({ LANG: 'C' }, 'de')).toBe('de')
    expect(languageFor({ LANG: 'C.UTF-8' }, 'de')).toBe('de')
  })

  it('translates once German is chosen and stays English otherwise', () => {
    const [english, german] = Object.entries(bundle).find(([message]) => placeholders(message).length === 0) ?? []
    if (english === undefined) return

    setLanguage('fr')
    expect(t(english)).toBe(english)
    setLanguage('de-CH')
    expect(t(english)).toBe(german)
  })

  it('keeps the values of a journal note apart from its template', () => {
    expect(template('Sync not possible: {0}', 'offline')).toEqual({
      message: 'Sync not possible: {0}',
      args: ['offline'],
    })
  })
})
