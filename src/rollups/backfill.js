// Builds rollups for all existing history. Run: npm run rollup:backfill
//
// Limit to one domain: ACKEE_DOMAIN=<id> npm run rollup:backfill
import mongoose from 'mongoose'

import Domain from '../models/Domain.js'
import config from '../utils/config.js'
import connect from '../utils/connect.js'
import signale from '../utils/signale.js'
import stripUrlAuth from '../utils/stripUrlAuth.js'
import { backfill } from './worker.js'

if (config.dbUrl == null) {
  signale.fatal('MongoDB connection URI missing in environment')
  process.exit(1)
}

signale.await(`Connecting to ${stripUrlAuth(config.dbUrl)}`)
await connect(config.dbUrl)
signale.success('Connected')

const only = process.env.ACKEE_DOMAIN
const domains = only == null ? await Domain.find().select('id title').lean() : [{ id: only, title: only }]

for (const domain of domains) {
  const started = Date.now()
  signale.start(`Backfilling ${domain.title} (${domain.id})`)

  const { chunks, documents } = await backfill(domain.id, ({ chunks, until }) => {
    if (chunks % 10 === 0) signale.info(`  ${chunks} days, up to ${until.toISOString()}`)
  })

  signale.success(
    `${domain.title}: ${chunks} days, ${documents} rollup documents, ${Math.round((Date.now() - started) / 1000)}s`,
  )
}

await mongoose.disconnect()
