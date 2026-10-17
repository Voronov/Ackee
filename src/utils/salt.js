import schedule from 'node-schedule'
import crypto from 'node:crypto'

const generate = () => crypto.randomBytes(16).toString('hex')
let salt = generate()

// Generate a new salt every day
export const rule = new schedule.RecurrenceRule()
rule.hour = 0
// Without a minute the rule fires every minute of that hour
rule.minute = 0

export const job = schedule.scheduleJob(rule, () => (salt = generate()))

export default () => salt
