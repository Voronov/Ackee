export default (browsers = []) => {
  return browsers.map((browser) => ({
    text: browser.value,
    count: browser.count,
    // What a click on the entry filters the reports by (ACKEE-24)
    filter: browser.filter ?? null,
    date: browser.created == null ? null : new Date(browser.created),
  }))
}
