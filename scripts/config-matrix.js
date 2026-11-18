import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/*
 * Compares the environment of the stands with docs/Options.md (ACKEE-104):
 *
 *   node scripts/config-matrix.js [--write docs/engineering/config-matrix.md] local=contributing \
 *     dev=<(ssh hosting2 'docker inspect ackee-dev --format "{{json .Config.Env}}"') \
 *     live=<(ssh hosting2 'docker inspect ackee-live --format "{{json .Config.Env}}"')
 *
 * A stand is a JSON array of KEY=VALUE strings (docker inspect) or an env file. `contributing`
 * reads the local .env of CONTRIBUTING.md, run with `npm run dev`. Secret values never leave this
 * process: the table only says whether they are set and whether two stands share them.
 */
const ROOT = path.resolve(import.meta.dirname, '..')
const START = '<!-- config-matrix:start -->'
const END = '<!-- config-matrix:end -->'

// Names whose value is never printed
const SECRET_NAME = /PASS|SECRET|TOKEN|KEY|USER|CREDENTIAL|PRIVATE|AUTH|CLIENT_ID|SALT/

// Set by the image or the shell, not by Ackee's configuration
export const PLATFORM = new Set(['HOME', 'HOSTNAME', 'NODE_VERSION', 'PATH', 'TERM', 'YARN_VERSION'])

export const isSecret = (name) => SECRET_NAME.test(name)

// What the table shows for one value. Only names and harmless values get through.
export const maskValue = (name, value) => {
  if (value === undefined) return 'not set'
  if (value === '') return 'empty'
  if (isSecret(name)) return 'set'
  // A URI can carry a password even under a harmless name
  if (/^[a-z][\d+.a-z-]*:\/\/[^/@\s]*@/i.test(value)) return 'set (URI with credentials)'
  // A long random-looking string is a key, whatever its name says
  if (value.length >= 32 && /^[\w+./=-]+$/.test(value) && value.includes('://') === false)
    return 'set (looks like a key)'

  return `\`${value.replaceAll('|', String.raw`\|`)}\``
}

// KEY=VALUE pairs from a docker inspect array or from an env file
export const parseEnv = (text) => {
  const trimmed = text.trim()
  const lines = trimmed.startsWith('[') ? JSON.parse(trimmed) : trimmed.split('\n')
  const env = new Map()

  for (const line of lines) {
    const match = /^\s*(?:export\s+)?([A-Z_a-z]\w*)=(.*)$/.exec(line)
    if (match == null || line.trim().startsWith('#')) continue
    env.set(match[1], match[2].replace(/^(['"])(.*)\1$/, '$2'))
  }

  return env
}

// Every NAME=value line inside a code block of Options.md
export const documentedVariables = (markdown) => {
  const names = new Set()

  for (const [, block] of markdown.matchAll(/```[^\n]*\n([\S\s]*?)```/g)) {
    for (const [, name] of block.matchAll(/^([A-Z][\dA-Z_]*)=/gm)) names.add(name)
  }

  return names
}

// One row per variable. `stands` is a Map of stand name → env Map, in column order.
export const buildMatrix = ({ documented, stands }) => {
  const names = new Set(documented)
  const platform = new Set()

  for (const env of stands.values()) {
    for (const name of env.keys()) (PLATFORM.has(name) ? platform : names).add(name)
  }

  const rows = [...names].toSorted().map((name) => {
    const values = [...stands.values()].map((env) => env.get(name))
    const cells = values.map((value, index) => {
      // A secret shared with an earlier stand says so, without showing either value
      const shared = isSecret(name) && value ? values.indexOf(value) : index
      return shared === index ? maskValue(name, value) : `set, same as ${[...stands.keys()][shared]}`
    })

    // Stands that still agree, e.g. "differs (dev = live)" when only local is different
    const groups = Map.groupBy([...stands.keys()], (stand, index) => values[index])
    const agreeing = [...groups.values()].filter((group) => group.length > 1).map((group) => group.join(' = '))
    let status = groups.size === 1 ? 'same' : 'differs'
    if (groups.size > 1 && agreeing.length > 0) status = `differs (${agreeing.join(', ')})`
    if (documented.has(name) === false) status = 'unknown'
    else if (values.every((value) => value === undefined)) status = 'set nowhere'

    return { name, cells, status }
  })

  return { rows, platform: [...platform].toSorted() }
}

// The hand-written "why" of each variable, from a table made earlier
export const readWhy = (markdown) => {
  const why = new Map()

  for (const [, name, reason] of markdown.matchAll(/^\| `([\dA-Z_]+)` *\|.*\| ([^|]*?) *\|$/gm)) {
    why.set(name, reason)
  }

  return why
}

export const render = ({ rows, platform }, standNames, why = new Map()) => {
  const header = ['Variable', ...standNames, 'Status', 'Why']
  const lines = [`| ${header.join(' | ')} |`, `|${header.map(() => ' --- |').join('')}`]

  for (const { name, cells, status } of rows) {
    lines.push(`| \`${name}\` | ${cells.join(' | ')} | ${status} | ${why.get(name) ?? ''} |`)
  }

  const flagged = (status) =>
    rows
      .filter((row) => row.status === status)
      .map((row) => `\`${row.name}\``)
      .join(', ') || 'none'

  return [
    lines.join('\n'),
    `Not in Options.md: ${flagged('unknown')}.`,
    `Documented but set nowhere: ${flagged('set nowhere')}.`,
    `Set by the image, not compared: ${platform.map((name) => `\`${name}\``).join(', ') || 'none'}.`,
  ].join('\n\n')
}

// The .env CONTRIBUTING.md asks for, with the NODE_ENV of `npm run dev`
const contributingEnv = async () => {
  const markdown = await readFile(path.join(ROOT, 'CONTRIBUTING.md'), 'utf8')
  const block = /put this in `\.env`[\S\s]*?```[^\n]*\n([\S\s]*?)```/.exec(markdown)
  const env = parseEnv(block?.[1] ?? '')
  env.set('NODE_ENV', 'development')

  return env
}

const main = async (argv) => {
  const writeIndex = argv.indexOf('--write')
  const target = writeIndex === -1 ? undefined : argv[writeIndex + 1]
  const specs = argv.filter(
    (argument, index) => argument.includes('=') && (writeIndex === -1 || index !== writeIndex + 1),
  )

  const stands = new Map()
  for (const spec of specs) {
    const [name, source] = spec.split(/=(.*)/s)
    if (source === 'contributing') {
      stands.set(name, await contributingEnv())
      continue
    }
    stands.set(name, parseEnv(await readFile(source === '-' ? 0 : source, 'utf8')))
  }

  const documented = documentedVariables(await readFile(path.join(ROOT, 'docs/Options.md'), 'utf8'))
  const matrix = buildMatrix({ documented, stands })

  if (target == null) {
    process.stdout.write(`${render(matrix, [...stands.keys()])}\n`)
    return
  }

  const current = await readFile(target, 'utf8')
  const [before, rest] = current.split(START)
  const after = rest.split(END)[1]
  const table = render(matrix, [...stands.keys()], readWhy(rest.split(END)[0]))

  // Formatted like the rest of the docs, so `npm run lint` stays green after a refresh
  const prettier = await import('prettier')
  const options = await prettier.resolveConfig(target)
  const text = await prettier.format(`${before}${START}\n\n${table}\n\n${END}${after}`, {
    ...options,
    filepath: target,
  })
  await writeFile(target, text)
}

if (process.argv[1] === import.meta.filename) await main(process.argv.slice(2))
