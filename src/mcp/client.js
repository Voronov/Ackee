/*
 * Talks to a running Ackee over its own API.
 *
 * Reading the database directly would be shorter, and wrong: the API is where a token is
 * turned into a viewer and a viewer into a set of workspaces. Going around it would mean
 * writing that scoping a second time, and a second copy is a second chance to get it
 * wrong. So the MCP server is an ordinary client, no more privileged than the interface.
 */
export default (url, token) => {
  const endpoint = new URL('/api', url).href

  return async (query, variables = {}) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
    })

    if (response.status === 401) throw new Error('Ackee refused the token. Check ACKEE_TOKEN.')
    if (response.ok === false) throw new Error(`Ackee answered with status ${response.status}`)

    const body = await response.json()

    // GraphQL answers 200 with an errors array, so a failure has to be looked for.
    if (body.errors != null) {
      const message = body.errors.map((error) => error.message).join('; ')

      // A rejected token comes back this way rather than as a 401, and "Token invalid"
      // on its own does not tell whoever set this up which token is meant.
      if (message.startsWith('Token ') === true) throw new Error(`Ackee said: ${message}. Check ACKEE_TOKEN.`)

      throw new Error(message)
    }

    return body.data
  }
}
