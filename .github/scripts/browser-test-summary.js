// Writes the result of the browser tests as a table: what the stand can do, one line per test.
//
//   node .github/scripts/browser-test-summary.js test-results/results.json >> "$GITHUB_STEP_SUMMARY"
import { readFileSync } from 'node:fs'

const report = JSON.parse(readFileSync(process.argv[2], 'utf8'))

const specs = []
const walk = (suite, file) => {
  for (const spec of suite.specs ?? []) specs.push({ file: suite.file ?? file, spec })
  for (const child of suite.suites ?? []) walk(child, suite.file ?? file)
}
for (const suite of report.suites) walk(suite, suite.file)

const mark = { passed: '✅', failed: '❌', timedOut: '❌', skipped: '⏭️', flaky: '⚠️' }
const outcome = (spec) => {
  const [test] = spec.tests
  const results = test.results ?? []
  if (test.status === 'flaky') return 'flaky'
  return results.at(-1)?.status ?? test.status ?? 'skipped'
}

const byFile = Map.groupBy(specs, ({ file }) => file)
const total = specs.length
const failed = specs.filter(({ spec }) => ['failed', 'timedOut'].includes(outcome(spec))).length

console.log(`## Browser tests: ${total - failed} of ${total} passed`)
console.log('')

for (const [file, group] of byFile) {
  console.log(`### ${file.replace('.browser.js', '')}`)
  console.log('')
  console.log('| | Test | Time |')
  console.log('|---|---|---|')
  for (const { spec } of group) {
    const status = outcome(spec)
    const seconds = ((spec.tests[0].results ?? []).reduce((sum, result) => sum + result.duration, 0) / 1000).toFixed(1)
    console.log(`| ${mark[status] ?? '❔'} | ${spec.title.replaceAll('|', String.raw`\|`)} | ${seconds} s |`)
  }
  console.log('')
}

console.log(
  `Total ${(report.stats.duration / 1000).toFixed(0)} s. The full report with videos is in the artifact \`browser-tests\`.`,
)
