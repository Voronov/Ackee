import useSelectedDomain from '../../../hooks/useSelectedDomain.js'
import useDomains from './useDomains.js'

// The domains an insights page draws a card for: the one picked on the dashboard, or all (ACKEE-81)
export default () => {
  const domains = useDomains()
  const selected = useSelectedDomain()

  const picked = domains.value.filter((domain) => domain.id === selected)

  return { ...domains, value: picked.length === 0 ? domains.value : picked }
}
