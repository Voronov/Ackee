import isUrl from 'is-url'

export default (referrers = []) => {
  return referrers.map((referrer) => ({
    url: isUrl(referrer.value) === true ? new URL(referrer.value) : null,
    text: isUrl(referrer.value) === true ? new URL(referrer.value).href : referrer.value,
    count: referrer.count,
    // What a click on the entry filters the reports by (ACKEE-24)
    filter: referrer.filter ?? null,
    date: referrer.created == null ? null : new Date(referrer.created),
  }))
}
