import userTimeZone from '../../../utils/timeZone.js'
import { get as getToken } from '../hooks/useToken.js'

/*
 * Saves a report as a file.
 *
 * A plain link cannot do this: the export route wants a bearer token, and a link sends
 * no headers. So the browser fetches the file itself and hands the result to a hidden
 * anchor, which is the only way to make a browser save something it already has.
 */

// The server names the file. This reads that name back, and falls back to a plain one if
// the header is missing or shaped differently than expected.
const filenameOf = (headers, fallback) => {
  const match = /filename="([^"]+)"/.exec(headers.get('content-disposition') ?? '')

  return match == null ? fallback : match[1]
}

export default async (domainId, report, format, options = {}) => {
  const url = new URL(`/export/${domainId}/${report}.${format}`, globalThis.location.origin)

  if (options.range != null) url.searchParams.set('range', options.range)
  if (options.limit != null) url.searchParams.set('limit', String(options.limit))

  const response = await fetch(url.href, {
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      'Time-Zone': userTimeZone,
    },
  })

  if (response.ok === false) {
    const body = await response.json().catch(() => ({}))

    throw new Error(body.error ?? `Export failed with status ${response.status}`)
  }

  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = objectUrl
  anchor.download = filenameOf(response.headers, `${report}.${format}`)

  document.body.append(anchor)
  anchor.click()
  anchor.remove()

  // The blob stays in memory until it is released, and a report can be large.
  URL.revokeObjectURL(objectUrl)
}
