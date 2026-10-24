import test from 'ava'

import sometimes from '../../src/utils/sometimes.js'

test('logs the first line at once and then once per interval, for each key', (t) => {
  let clock = 0
  const lines = []
  const log = sometimes(60, () => clock)
  const write = (key) => log(key, () => lines.push(`${key}@${clock}`))

  write('mongo')
  write('redis')
  clock = 59
  write('mongo')
  clock = 60
  write('mongo')
  write('redis')

  t.deepEqual(lines, ['mongo@0', 'redis@0', 'mongo@60', 'redis@60'])
})

test('after a reset the next line is logged at once', (t) => {
  let clock = 0
  const lines = []
  const log = sometimes(60, () => clock)

  log('mongo', () => lines.push(clock))
  clock = 10
  log.reset()
  log('mongo', () => lines.push(clock))

  t.deepEqual(lines, [0, 10])
})
