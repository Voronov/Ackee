export default (pages = []) => {
  return pages.map((page) => ({
    url: new URL(page.value),
    text: new URL(page.value).href,
    count: page.count,
    // What a click on the entry filters the reports by (ACKEE-24)
    filter: page.filter ?? null,
    date: page.created == null ? null : new Date(page.created),
  }))
}
