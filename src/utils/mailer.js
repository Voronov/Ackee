import { createTransport } from 'nodemailer'

import config from './config.js'
import signale from './signale.js'

// Outgoing mail. Without SMTP settings the whole thing is off, and the parts that depend
// on it say so rather than failing quietly.
let transport = null

export const isEnabled = () => config.smtpHost != null && config.smtpHost !== ''

const getTransport = () => {
  if (isEnabled() === false) return null

  transport ??= createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    // Port 465 speaks TLS from the first byte; 587 upgrades with STARTTLS.
    secure: config.smtpPort === 465,
    requireTLS: config.smtpPort !== 465,
    auth: { user: config.smtpUser, pass: config.smtpPassword },
  })

  return transport
}

export const send = async ({ to, subject, text, html }) => {
  if (isEnabled() === false) {
    signale.warn(`Email to ${to} not sent: SMTP is not configured`)
    return false
  }

  try {
    await getTransport().sendMail({ from: config.smtpFrom, to, subject, text, html })

    return true
  } catch (error) {
    // A failed email must not break the request that triggered it. The caller decides
    // what to tell the user.
    signale.fatal(`Email to ${to} failed: ${error.message}`)

    return false
  }
}

// Checks the settings once at start-up, so a wrong password is found now rather than by
// the first person who tries to register.
export const check = async () => {
  if (isEnabled() === false) return false

  try {
    await getTransport().verify()
    signale.info(`SMTP ready at ${config.smtpHost}:${config.smtpPort}`)

    return true
  } catch (error) {
    signale.fatal(`SMTP check failed: ${error.message}`)

    return false
  }
}
