/*
 * Two letters to stand in for a person.
 *
 * An email is all we have, so the part before the @ is used. Addresses written as
 * "first.last" give one letter from each; anything else gives the first two letters,
 * which is still enough to tell two accounts apart at a glance.
 */
export default (email) => {
  if (typeof email !== 'string' || email === '') return '?'

  const [local] = email.split('@')
  const parts = local.split(/[._-]+/).filter(Boolean)

  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()

  return local.slice(0, 2).toUpperCase()
}
