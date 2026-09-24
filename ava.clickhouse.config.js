// Integration tests that need ClickHouse and Redis from docker-compose.dev.yml; run via `npm run test:ch`
export default {
  files: ['test/clickhouse/**/*.js', 'test/queue/**/*.js'],
  timeout: '30s',
  verbose: true,
}
