import { rememberedLanguage } from '../core/config.js'
import { languageFor, setLanguage } from '../core/l10n.js'
import { main } from './main.js'
import { nodeTooOld } from './node-version.js'

// Here and not in main(), so tests run in English whatever the machine's locale.
setLanguage(languageFor(process.env, rememberedLanguage()))

// Before any command touches ~/.prosonata: a Node without fetch would fail
// only at the first request, possibly after state was already written, and
// in the hook that failure is swallowed by its `|| true`.
const tooOld = nodeTooOld(process.versions.node, process.execPath)

if (tooOld) {
  process.stderr.write(tooOld)
  process.exitCode = 1
} else {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((error: unknown) => {
      process.stderr.write(`${(error as Error).message}\n`)
      process.exitCode = 1
    })
}
