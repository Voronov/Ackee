import crypto from 'node:crypto'

/*
 * A passkey authenticator in software, for tests (ACKEE-80). It answers the options the server
 * hands out the way a browser and a security key would: attestation "none", an ES256 key, a
 * signature counter. The server checks its answers with the real WebAuthn library.
 */

// Just enough CBOR for an attestation object and a COSE key: maps, byte and text strings, integers
const head = (major, length) => {
  if (length < 24) return Buffer.from([(major << 5) | length])
  if (length < 256) return Buffer.from([(major << 5) | 24, length])
  return Buffer.from([(major << 5) | 25, Math.floor(length / 256), length % 256])
}

const cbor = (value) => {
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value])
  if (typeof value === 'string') return Buffer.concat([head(3, Buffer.byteLength(value)), Buffer.from(value)])
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value)
  if (value instanceof Map) {
    return Buffer.concat([head(5, value.size), ...[...value].flatMap(([key, item]) => [cbor(key), cbor(item)])])
  }
  throw new Error(`No CBOR for ${typeof value}`)
}

const sha256 = (data) => crypto.createHash('sha256').update(data).digest()
const b64 = (buffer) => Buffer.from(buffer).toString('base64url')

const UP = 0x01
const UV = 0x04
const AT = 0x40

export default class SoftAuthenticator {
  constructor(origin) {
    this.origin = origin
    this.rpId = new URL(origin).hostname
    this.keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    this.credentialId = crypto.randomBytes(16)
    this.counter = 0
    this.userHandle = null
  }

  authData(flags, attested) {
    const counter = Buffer.alloc(4)
    counter.writeUInt32BE(this.counter)

    return Buffer.concat([sha256(this.rpId), Buffer.from([flags]), counter, attested ?? Buffer.alloc(0)])
  }

  clientData(type, challenge, origin = this.origin) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }))
  }

  // An answer to navigator.credentials.create
  register(options, { origin } = {}) {
    this.userHandle = options.user.id
    const { x, y } = this.keys.publicKey.export({ format: 'jwk' })
    const coseKey = cbor(
      new Map([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(x, 'base64url')],
        [-3, Buffer.from(y, 'base64url')],
      ]),
    )
    const length = Buffer.alloc(2)
    length.writeUInt16BE(this.credentialId.length)
    const attested = Buffer.concat([Buffer.alloc(16), length, this.credentialId, coseKey])

    const attestationObject = cbor(
      new Map([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', this.authData(UP | UV | AT, attested)],
      ]),
    )

    return {
      id: b64(this.credentialId),
      rawId: b64(this.credentialId),
      type: 'public-key',
      response: {
        clientDataJSON: b64(this.clientData('webauthn.create', options.challenge, origin)),
        attestationObject: b64(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
    }
  }

  // An answer to navigator.credentials.get. `counter` lets a test play a cloned key.
  authenticate(options, { origin, counter } = {}) {
    this.counter = counter ?? this.counter + 1
    const authenticatorData = this.authData(UP | UV)
    const clientDataJSON = this.clientData('webauthn.get', options.challenge, origin)
    const signature = crypto.sign(
      'sha256',
      Buffer.concat([authenticatorData, sha256(clientDataJSON)]),
      this.keys.privateKey,
    )

    return {
      id: b64(this.credentialId),
      rawId: b64(this.credentialId),
      type: 'public-key',
      response: {
        clientDataJSON: b64(clientDataJSON),
        authenticatorData: b64(authenticatorData),
        signature: b64(signature),
        userHandle: this.userHandle,
      },
      clientExtensionResults: {},
    }
  }
}
