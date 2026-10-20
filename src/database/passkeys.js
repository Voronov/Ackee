import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'

import Passkey from '../models/Passkey.js'
import WebAuthnChallenge from '../models/WebAuthnChallenge.js'
import config from '../utils/config.js'

/*
 * Passkeys (ACKEE-80). The relying party is this instance's public address: the browser binds
 * every passkey to it, so a passkey made for dev never signs anyone in on live.
 */
export const isEnabled = () => Boolean(config.publicUrl)

const origin = () => new URL(config.publicUrl).origin
const rpID = () => new URL(config.publicUrl).hostname

const response = (entry) => ({
  id: entry.id,
  name: entry.name,
  created: entry.created,
  lastUsed: entry.lastUsed ?? null,
})

// Uses a challenge up in one step. The library calls this with the challenge it found in the
// browser's answer, so an answer to some other challenge never matches.
const claim = (purpose, userId) => async (challenge) => {
  const entry = await WebAuthnChallenge.findOneAndUpdate(
    { challenge, purpose, used: false, expires: { $gt: new Date() }, ...(userId == null ? {} : { userId }) },
    { $set: { used: true } },
  )

  return entry != null
}

export const registrationOptions = async (user) => {
  const existing = await Passkey.find({ userId: user.id }).lean()

  const options = await generateRegistrationOptions({
    rpName: 'Ackee',
    rpID: rpID(),
    userName: user.email,
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    // The same authenticator twice would only be a duplicate
    excludeCredentials: existing.map((passkey) => ({ id: passkey.credentialId, transports: passkey.transports })),
    // Discoverable, so the sign-in needs no address at all
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  })

  await WebAuthnChallenge.create({ challenge: options.challenge, purpose: 'REGISTER', userId: user.id })

  return options
}

// A string is the reason it was refused
export const register = async (user, answer, name) => {
  let verification

  try {
    verification = await verifyRegistrationResponse({
      response: answer,
      expectedChallenge: claim('REGISTER', user.id),
      expectedOrigin: origin(),
      expectedRPID: rpID(),
      requireUserVerification: false,
    })
  } catch (error) {
    return `The passkey could not be added: ${error.message}`
  }

  if (verification.verified !== true) return 'The passkey could not be added'

  const { credential } = verification.registrationInfo

  if ((await Passkey.exists({ credentialId: credential.id })) != null) return 'This passkey is already added'

  const entry = await Passkey.create({
    userId: user.id,
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports ?? [],
    name,
  })

  return response(entry)
}

export const authenticationOptions = async () => {
  // No allowCredentials: the authenticator offers the passkeys it holds for this site
  const options = await generateAuthenticationOptions({ rpID: rpID(), userVerification: 'preferred' })

  await WebAuthnChallenge.create({ challenge: options.challenge, purpose: 'AUTHENTICATE' })

  return options
}

// The user id behind a valid answer, or a string with the reason it was refused
export const authenticate = async (answer) => {
  const passkey = await Passkey.findOne({ credentialId: String(answer?.id ?? '') })

  if (passkey == null) return 'This passkey is not known here'

  let verification

  try {
    verification = await verifyAuthenticationResponse({
      response: answer,
      expectedChallenge: claim('AUTHENTICATE'),
      expectedOrigin: origin(),
      expectedRPID: rpID(),
      credential: {
        id: passkey.credentialId,
        publicKey: Buffer.from(passkey.publicKey, 'base64url'),
        counter: passkey.counter,
        transports: passkey.transports,
      },
      requireUserVerification: false,
    })
  } catch (error) {
    return `The passkey was not accepted: ${error.message}`
  }

  if (verification.verified !== true) return 'The passkey was not accepted'

  await Passkey.updateOne(
    { id: passkey.id },
    { $set: { counter: verification.authenticationInfo.newCounter, lastUsed: new Date() } },
  )

  return { userId: passkey.userId }
}

export const all = async (userId) => {
  const entries = await Passkey.find({ userId }).sort({ created: 1 }).lean()

  return entries.map(response)
}

export const del = async (id, userId) => {
  const entry = await Passkey.findOneAndDelete({ id, userId })

  return entry == null ? null : response(entry)
}

// A password reset often follows a takeover, and a passkey the intruder added would outlive the
// new password. So a reset removes every passkey, like every session.
export const delByUser = (userId) => Passkey.deleteMany({ userId })
