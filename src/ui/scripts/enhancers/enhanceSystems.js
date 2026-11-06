export default (systems = []) => {
  return systems.map((system) => ({
    text: system.value,
    count: system.count,
    // What a click on the entry filters the reports by (ACKEE-24)
    filter: system.filter ?? null,
    date: system.created == null ? null : new Date(system.created),
  }))
}
