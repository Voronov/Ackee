import isValidDomain from 'is-valid-domain'

import * as domains from '../database/domains.js'

export default async () => {
  // Every domain on the instance: CORS is decided before the request is authenticated.
  const allDomains = await domains.allUnscoped()
  const allTitles = allDomains.map((domain) => domain.title)
  const fullyQualifiedDomainNames = allTitles.filter((title) =>
    isValidDomain(title, { subdomain: true, wildcard: false, allowUnicode: true }),
  )

  return fullyQualifiedDomainNames
}
