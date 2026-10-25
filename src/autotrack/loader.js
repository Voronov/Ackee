import { readFile } from 'node:fs/promises'
import path from 'node:path'

import express from 'express'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import { getClientIp } from 'request-ip'

import * as tracking from '../database/tracking.js'
import Domain from '../models/Domain.js'
import config from '../utils/config.js'
import autotrack from './client.js'

/*
 * /t/<id>.js, the one snippet a site needs (ACKEE-25): the tracker, the domain's tracking rules
 * and the code that applies them. A change in Ackee reaches the site within a minute, without
 * touching its code.
 */
const tracker = readFile(path.resolve(import.meta.dirname, '../../dist/tracker.js'), 'utf8')

// The address the owner set, if any. Nothing from the request goes into a script that is cached
// publicly (review of #36): a forged Host would poison a cache in front of Ackee. Without
// ACKEE_URL the site takes the address the script came from, see client.js.
const server = () => config.publicUrl?.replace(/\/$/, '') ?? ''

// JSON inside a script: a "</script>" in a selector or label must not end the script early
const inline = (value) => JSON.stringify(value).replaceAll('<', String.raw`\u003c`)

export const build = async (domain, trackingId, server) => {
  const settings = tracking.of(domain)
  const options = {
    server,
    domainId: trackingId,
    ignoreLocalhost: true,
    gtmId: settings.gtmId,
    outbound: settings.outbound,
    downloads: settings.downloads,
    downloadExtensions: settings.downloadExtensions,
    scroll: settings.scroll,
    vitals: settings.vitals,
    rules: settings.rules,
    events: settings.events,
  }

  return `${await tracker}\n;(${autotrack.toString()})(${inline(options)})\n`
}

const router = express.Router()

// Every page view of a site loads the script, and a whole office can share one address, so the
// limit is generous: it only stops someone hammering the database through this route.
const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 1000,
  keyGenerator: (request) => ipKeyGenerator(getClientIp(request) ?? ''),
  handler: (request, response) => response.status(429).type('text/javascript').send('/* Too many requests */\n'),
})

router.get('/t/:file', limiter, async (request, response) => {
  response.type('text/javascript; charset=utf-8')

  // <id>.js or <id>.<ingest key>.js, the same id the plain snippet carries
  const match = /^([\w-]+)(?:\.([\w-]+))?\.js$/.exec(request.params.file)
  const domain = match == null ? null : await Domain.findOne({ id: match[1] })

  // A wrong key, or none where the domain demands one, would only record nothing. Saying so
  // here shows the owner at once.
  const key = match?.[2]
  const refused = domain == null || (key != null && key !== domain.ingestKey) || (domain.strictIngest && key == null)
  if (refused) return response.status(404).send('/* Unknown Ackee domain or ingest key */\n')

  // Short, so a change of the rules reaches the site soon. Express adds an ETag on its own.
  response.setHeader('Cache-Control', 'public, max-age=60')
  // The key from the database, not the one from the address: they are equal by now, and nothing
  // from the request goes into the script
  response.send(await build(domain, key == null ? domain.id : `${domain.id}.${domain.ingestKey}`, server()))
})

export default router
