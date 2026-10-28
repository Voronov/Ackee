import test from 'ava'
import { readFileSync } from 'node:fs'

// Nobody can approve their own pull request. A path with a single owner could not be merged
// when that owner wrote the change, so every rule has to name at least two (ACKEE-53).
const rules = readFileSync(new URL('../.github/CODEOWNERS', import.meta.url), 'utf8')
  .split('\n')
  .map((line) => line.replace(/#.*/, '').trim())
  .filter((line) => line !== '')
  .map((line) => {
    const [path, ...owners] = line.split(/\s+/)
    return { path, owners }
  })

test('every rule of CODEOWNERS names at least two owners', (t) => {
  t.true(rules.length > 0)

  for (const { path, owners } of rules) {
    t.true(owners.length >= 2, `${path} has ${owners.length} owner(s)`)
    t.true(
      owners.every((owner) => /^@[\w-]+(\/[\w-]+)?$/.test(owner)),
      `${path}: ${owners.join(' ')}`,
    )
  }
})

test('a catch-all rule covers every path', (t) => {
  t.true(rules.some((rule) => rule.path === '*'))
})
