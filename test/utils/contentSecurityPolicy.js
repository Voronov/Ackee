import test from 'ava'
import { createHash } from 'node:crypto'

import { directivesFor, scriptOnlyPolicy } from '../../src/utils/contentSecurityPolicy.js'
import layout from '../../src/utils/layout.js'

const hash = (code) => `'sha256-${createHash('sha256').update(code).digest('base64')}'`

test('allows exactly the inline scripts of the page', (t) => {
  const { scriptSrc } = directivesFor(
    '<script>one()</script><script defer src="a.js"></script><script>\n two()\n</script>',
  )

  t.deepEqual(scriptSrc, ["'self'", hash('one()'), hash('\n two()\n')])
})

test('covers both inline scripts of the generated UI', (t) => {
  const html = layout('', 'favicon.ico', ['index.css'], ['index.js'], { isDemoMode: false })

  t.is(directivesFor(html).scriptSrc.length, 3)
})

test('a page without inline scripts allows only its own origin', (t) => {
  t.deepEqual(directivesFor('').scriptSrc, ["'self'"])
})

test('blocks inline handlers and foreign connections', (t) => {
  const directives = directivesFor('')

  t.deepEqual(directives.scriptSrcAttr, ["'none'"])
  t.deepEqual(directives.connectSrc, ["'self'"])
  t.deepEqual(directives.objectSrc, ["'none'"])
})

test('a page made per request runs only its own script', (t) => {
  t.is(scriptOnlyPolicy('<script>one()</script>'), `default-src 'none'; script-src ${hash('one()')}`)
})
