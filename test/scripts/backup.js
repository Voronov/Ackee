import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

import test from 'ava'

const script = path.resolve('deploy/ackee-backup')

// Stands in for docker: mongodump prints the file DUMP, mongorestore passes everything.
const stand = (dump) => {
  const root = mkdtempSync(path.join(tmpdir(), 'ackee-backup-'))
  const bin = path.join(root, 'bin')
  const dir = path.join(root, 'backups')
  mkdirSync(bin)
  mkdirSync(dir)

  writeFileSync(path.join(root, 'dump'), dump)
  writeFileSync(
    path.join(bin, 'docker'),
    `#!/bin/sh\ncase "$*" in *mongodump*) cat "${path.join(root, 'dump')}" ;; *) cat > /dev/null ;; esac\n`,
  )
  chmodSync(path.join(bin, 'docker'), 0o755)

  return { bin, dir }
}

const run = ({ bin, dir }, environment = {}) =>
  spawnSync('sh', [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      ACKEE_BACKUP_DIR: dir,
      ACKEE_BACKUP_MIN_FREE_MB: '1',
      ACKEE_BACKUP_MIN_SIZE_KB: '1',
      ...environment,
    },
  })

const archives = ({ dir }) => readdirSync(dir).filter((name) => name.endsWith('.archive.gz'))

const noise = () => gzipSync(Buffer.from(Array.from({ length: 200_000 }, () => Math.floor(Math.random() * 256))))

test('keeps a whole dump', (t) => {
  const paths = stand(noise())
  const { status, stdout } = run(paths)

  t.is(status, 0)
  t.regex(stdout, /OK:/)
  t.is(archives(paths).length, 1)
})

test('refuses a cut dump, which mongorestore --dryRun passes', (t) => {
  const dump = noise()
  const paths = stand(dump.subarray(0, dump.length / 2))
  const { status, stdout } = run(paths)

  t.not(status, 0)
  t.notRegex(stdout, /OK:/)
  t.deepEqual(readdirSync(paths.dir), [])
})

test('refuses the tiny dump of a missing database', (t) => {
  const paths = stand(gzipSync('empty'))
  const { status, stdout } = run(paths, { ACKEE_BACKUP_MIN_SIZE_KB: '1024' })

  t.not(status, 0)
  t.regex(stdout, /FAILED: dump is only/)
  t.deepEqual(readdirSync(paths.dir), [])
})

test('asks for room for the next dump on top of the reserve', (t) => {
  const paths = stand(noise())
  writeFileSync(path.join(paths.bin, 'df'), '#!/bin/sh\necho header\necho disk 100 90 10 90% /\n')
  chmodSync(path.join(paths.bin, 'df'), 0o755)
  writeFileSync(path.join(paths.dir, 'ackee_live-20260101-000000.archive.gz'), Buffer.alloc(2 * 1024 * 1024))

  const { status, stdout } = run(paths, { ACKEE_BACKUP_MIN_FREE_MB: '9' })

  t.not(status, 0)
  t.regex(stdout, /FAILED: only 10 MB free, need 11/)
})

test('removes what a killed run left, but not a running one', (t) => {
  const paths = stand(noise())
  const old = path.join(paths.dir, 'ackee_live-20260101-000000.archive.gz.tmp')
  const fresh = path.join(paths.dir, 'ackee_live-20260102-000000.archive.gz.tmp')
  writeFileSync(old, 'old')
  writeFileSync(fresh, 'fresh')
  utimesSync(old, new Date('2026-01-01'), new Date('2026-01-01'))

  t.is(run(paths).status, 0)

  const left = readdirSync(paths.dir)
  t.false(left.includes('ackee_live-20260101-000000.archive.gz.tmp'))
  t.true(left.includes('ackee_live-20260102-000000.archive.gz.tmp'))
})
