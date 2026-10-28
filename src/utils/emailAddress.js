// A shape check, not an existence one: only a message to the address can confirm it.
const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// The limits of RFC 5321. A mail server refuses a longer address, so accepting one here
// only stores something that can never be reached.
const MAXIMUM_LOCAL_PART_LENGTH = 64
const MAXIMUM_LENGTH = 254

export const looksLikeEmail = (value) => {
  const address = String(value)

  if (SHAPE.test(address) === false || address.length > MAXIMUM_LENGTH) return false

  return address.split('@')[0].length <= MAXIMUM_LOCAL_PART_LENGTH
}
