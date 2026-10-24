/**
 * Vercel Serverless Function entry point for the '/api/live' route.
 * Only answers that the live feed is not available in serverless deployments (ADR-007).
 */
import { handler } from '../src/serverless.js'

export default { fetch: handler }
