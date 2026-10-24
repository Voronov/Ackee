import useSelectedDomain from '../../../hooks/useSelectedDomain.js'
import useDomains from './useDomains.js'

// The picked domain for the report queries, once the list of domains confirms it (review of #34).
// Until then, and for a domain the viewer lost, the reports cover all domains: an "Unknown
// domain" answer would replace the dashboard before DomainSelect could reset the choice.
export default () => {
  const domains = useDomains()
  const selected = useSelectedDomain()

  return domains.value.some((domain) => domain.id === selected) ? selected : null
}
