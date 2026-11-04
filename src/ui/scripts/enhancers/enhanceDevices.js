export default (devices = []) => {
  return devices.map((device) => ({
    text: device.value,
    count: device.count,
    // What a click on the entry filters the reports by (ACKEE-24)
    filter: device.filter ?? null,
    date: device.created == null ? null : new Date(device.created),
  }))
}
