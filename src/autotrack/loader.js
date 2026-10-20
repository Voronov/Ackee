import { readFile } from 'node:fs/promises'
import path from 'node:path'

import express from 'express'

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

// The page loads the script from Ackee, so Ackee's own address is where the tracker reports to
const serverOf = (request) =>
  config.publicUrl?.replace(/\/$/, '') ??
  `${request.headers['x-forwarded-proto'] ?? request.protocol}://${request.get('host')}`

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

router.get('/t/:file', async (request, response) => {
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
  response.send(await build(domain, key == null ? domain.id : `${domain.id}.${key}`, serverOf(request)))
})

export default router
