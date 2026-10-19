// GraphQL access to an Ackee of the stand, for the spike tools. fetch gives up after 300 s
// of silence, which a v1.0 report under load may take, hence the explicit timeout.
const TIMEOUT = 600_000

export const query = async (url, body, { token, timeZone } = {}) => {
  const response = await fetch(new URL('/api', url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token == null ? {} : { Authorization: `Bearer ${token}` }),
      ...(timeZone == null ? {} : { 'Time-Zone': timeZone }),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  })

  if (response.ok === false) throw new Error(`${url}: HTTP ${response.status}`)

  const json = await response.json()
  if (json.errors != null) throw new Error(`${url}: ${json.errors.map((error) => error.message).join('; ')}`)

  return json.data
}

export const login = async (url, username, password) => {
  const data = await query(url, {
    query: 'mutation createToken($input: CreateTokenInput!) { createToken(input: $input) { payload { id } } }',
    variables: { input: { username, password } },
  })

  return data.createToken.payload.id
}

export const logout = (url, token) =>
  query(url, {
    query: 'mutation deleteToken($id: ID!) { deleteToken(id: $id) { success } }',
    variables: { id: token },
  })
