import { rememberedLanguage } from '../core/config.js'
import { languageFor, setLanguage } from '../core/l10n.js'
import { main } from './main.js'

// Here and not in main(), so tests run in English whatever the machine's locale.
setLanguage(languageFor(process.env, rememberedLanguage()))

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    process.stderr.write(`${(error as Error).message}\n`)
    process.exitCode = 1
  })
