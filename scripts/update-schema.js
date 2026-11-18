import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { printedSchema } from '../src/types/schema.js'

// Writes the schema snapshot that test/schema.js compares with. Run after a reviewed schema change.
const snapshotPath = fileURLToPath(new URL('../test/fixtures/schema.graphql', import.meta.url))

const target = process.argv[2] ?? snapshotPath

await writeFile(target, printedSchema())
