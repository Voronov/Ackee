import { get as getToken } from '../hooks/useToken.js'

// Saves a report as a file from /export (ACKEE-22). The token goes in the header, as for the
// API: a plain link cannot send it, and in the address it would end up in logs and history.
export default async (report, format, parameters) => {
  const query = new URLSearchParams(Object.entries(parameters).filter(([, value]) => value != null))
  const response = await fetch(`export/${report}.${format}?${query}`, {
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      'Time-Zone': Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  })

  if (response.ok === false) throw new Error(`Export failed with ${response.status}`)

  const name =
    /filename="([^"]+)"/u.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? `${report}.${format}`
  const url = URL.createObjectURL(await response.blob())
  const link = Object.assign(document.createElement('a'), { href: url, download: name })

  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
