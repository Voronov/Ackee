import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import test from 'ava'

const script = path.resolve('deploy/ackee-report')

const empty = JSON.stringify({ status: 'success', data: { resultType: 'vector', result: [] } })

// Stands in for docker: logs, inspect and the answers of Prometheus come from files of the stand
const stand = ({ logs = {}, restarts = {}, errors5xx = empty, audit = '{}' } = {}) => {
  const root = mkdtempSync(path.join(tmpdir(), 'ackee-report-'))
  const bin = path.join(root, 'bin')
  mkdirSync(bin)

  for (const container of ['ackee-live', 'ackee-dev']) {
    writeFileSync(path.join(root, `logs-${container}`), logs[container] ?? '')
    writeFileSync(path.join(root, `restarts-${container}`), String(restarts[container] ?? 0))
  }
  writeFileSync(path.join(root, 'errors5xx'), errors5xx)
  writeFileSync(path.join(root, 'empty'), empty)
  writeFileSync(path.join(root, 'audit'), audit)
  writeFileSync(
    path.join(root, 'mongo'),
    JSON.stringify({
      records: { 'shop.example': 3, 'northwind-coffee.example': 5 },
      ga4: [{ title: 'shop.example', lastSync: '2026-11-18T06:00:00.000Z', error: null, lastDay: '2026-11-17' }],
    }),
  )

  writeFileSync(
    path.join(bin, 'docker'),
    [
      '#!/bin/sh',
      `root='${root}'`,
      'last=$(eval echo \\${$#})',
      'case "$*" in',
      '  logs*) cat "$root/logs-$last" ;;',
      '  *RestartCount*) cat "$root/restarts-$last" ;;',
      '  *Config.Image*) echo ghcr.io/voronov/ackee:4.0.0 ;;',
      '  *Health.Status*) echo healthy ;;',
      '  *StartedAt*) echo 2026-11-18T13:32:01Z ;;',
      '  *ackee-prometheus*status%3D~%225..*%5B10m*) cat "$root/errors5xx" ;;',
      '  *ackee-prometheus*) cat "$root/empty" ;;',
      '  *HostConfig.Memory*) echo 671088640 ;;',
      '  *ackee-mongo*) cat "$root/mongo" ;;',
      '  *ackee-alertmanager*) echo "[]" ;;',
      '  run*) cat "$root/audit" ;;',
      'esac',
      '',
    ].join('\n'),
  )
  chmodSync(path.join(bin, 'docker'), 0o755)

  return { root, bin }
}

const run = ({ root, bin }, mode, environment = {}) =>
  spawnSync('python3', [script, mode], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      ACKEE_REPORT_DRY_RUN: '1',
      ACKEE_REPORT_ROOT: root,
      ACKEE_REPORT_STATE: path.join(root, 'state', 'state.json'),
      ACKEE_REPORT_BACKUP_LOG: path.join(root, 'backup.log'),
      ACKEE_REPORT_BACKUP_DIR: path.join(root, 'backups'),
      ACKEE_REPORT_FAIL2BAN_LOG: path.join(root, 'fail2ban.log'),
      ACKEE_REPORT_HOSTS: '',
      ...environment,
    },
  })

const fatal =
  '[Ackee] › ✖  fatal     TypeError: Cannot read properties of undefined (reading 9f1c2a3b-1111-4222-8333-944445555666)'
const introspection = '[Ackee] › ✖  fatal     GraphQLError: GraphQL introspection is not allowed by Apollo Server'

test('errors stays silent when nothing went wrong', (t) => {
  const { status, stdout } = run(stand(), 'errors')

  t.is(status, 0)
  t.is(stdout, '')
})

test('errors reports a fatal line of a stand, without its ids', (t) => {
  const { status, stdout } = run(stand({ logs: { 'ackee-live': `${fatal}\n[Ackee] › ℹ  info  ok\n` } }), 'errors')

  t.is(status, 0)
  t.regex(stdout, /live: 1 fatal/)
  t.regex(stdout, /reading <id>/)
  t.notRegex(stdout, /dev:/)
})

test('errors ignores the refused introspection from outside', (t) => {
  const { stdout } = run(stand({ logs: { 'ackee-dev': `${introspection}\n` } }), 'errors')

  t.is(stdout, '')
})

test('errors reports 5xx responses from Prometheus', (t) => {
  const errors5xx = JSON.stringify({
    status: 'success',
    data: {
      resultType: 'vector',
      result: [
        { metric: { job: 'ackee-live', route: '/api', status: '500' }, value: [0, '3.2'] },
        { metric: { job: 'ackee-dev', route: '/api', status: '502' }, value: [0, '0.2'] },
      ],
    },
  })
  const { stdout } = run(stand({ errors5xx }), 'errors')

  t.regex(stdout, /live: 3× HTTP 500 на \/api/)
  t.notRegex(stdout, /502/)
})

test('errors reports a restart once, on the run after it', (t) => {
  const paths = stand()
  t.is(run(paths, 'errors').stdout, '')

  writeFileSync(path.join(paths.root, 'restarts-ackee-dev'), '2')
  t.regex(run(paths, 'errors').stdout, /dev: контейнер перезапускався, рестартів 2/)
  t.is(run(paths, 'errors').stdout, '')
})

test('daily lists the stands, the server, the backups, security, GA4 and the alerts', (t) => {
  const paths = stand()
  writeFileSync(path.join(paths.root, 'backup.log'), '2026-11-18T03:30:26Z OK: ackee_live.archive.gz, 44 MB\n')
  mkdirSync(path.join(paths.root, 'backups'))
  writeFileSync(path.join(paths.root, 'backups', 'ackee_live-20261118-033002.archive.gz'), Buffer.alloc(2 * 2 ** 20))
  const recent = new Date(Date.now() - 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19)
  writeFileSync(
    path.join(paths.root, 'fail2ban.log'),
    `2020-01-01 00:00:00,000 fail2ban.actions [1]: NOTICE [sshd] Ban 192.0.2.1\n${recent},000 fail2ban.actions [1]: NOTICE [sshd] Ban 192.0.2.2\n`,
  )
  const { status, stdout } = run(paths, 'daily')

  t.is(status, 0)
  t.regex(stdout, /live: 4\.0\.0, healthy, рестартів 0, працює/)
  t.regex(stdout, /пам'ять до \? з 640 МБ/)
  t.regex(stdout, /помилки: 5xx \?, 4xx \?, fatal у журналі 0/)
  t.regex(stdout, /нових записів: сайти 3, тестовий домен 5/)
  t.regex(stdout, /Сервер\n {2}аптайм/)
  t.regex(stdout, /нічний запуск: OK, 18\.11 03:30 UTC/)
  t.regex(stdout, /у теці 1 архівів, 2 МБ/)
  t.regex(stdout, /нових банів за добу 1/)
  t.regex(stdout, /shop\.example: OK, синхронізовано 2026-11-18 06:00 UTC, дані до 2026-11-17/)
  t.regex(stdout, /Алерти: зараз немає; за добу спрацьовували жодні/)
})

test('security counts the advisories of the lock of each stand', (t) => {
  const audit = JSON.stringify({ metadata: { vulnerabilities: { critical: 1, high: 0, moderate: 2 } } })
  const paths = stand({ audit })
  const raw = path.join(paths.root, 'raw', '4.0.0')
  mkdirSync(raw, { recursive: true })
  writeFileSync(path.join(raw, 'package.json'), '{}')
  writeFileSync(path.join(raw, 'package-lock.json'), '{}')

  const { status, stdout } = run(paths, 'security', { ACKEE_REPORT_RAW_URL: `file://${path.join(paths.root, 'raw')}` })

  t.is(status, 0)
  t.regex(stdout, /live \(4\.0\.0\): critical 1, moderate 2/)
})

test('refuses an unknown mode', (t) => {
  const { status, stderr } = run(stand(), 'weekly')

  t.not(status, 0)
  t.regex(stderr, /Usage/)
})
