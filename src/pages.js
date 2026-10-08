import express from 'express'

import * as userTokens from './database/userTokens.js'
import * as users from './database/users.js'

/*
 * Pages that links in emails point at.
 *
 * They are plain server-rendered pages rather than part of the single-page interface.
 * A confirmation link has to work in any mail client, including one that opens it in a
 * stripped-down browser, so the fewer moving parts the better.
 */
const page = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Ackee</title>
<style>
:root { color-scheme: light dark; }
body {
  margin: 0; min-height: 100vh; display: grid; place-items: center;
  font: 16px/1.6 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: Canvas; color: CanvasText;
}
main { width: min(420px, calc(100% - 32px)); padding: 32px 0; }
h1 { font-size: 22px; margin: 0 0 8px; letter-spacing: -.01em; }
p { margin: 0 0 16px; color: color-mix(in srgb, CanvasText 65%, Canvas); }
label { display: block; font-size: 14px; margin-bottom: 6px; }
input, button {
  font: inherit; width: 100%; box-sizing: border-box; border-radius: 10px;
  border: 1px solid color-mix(in srgb, CanvasText 20%, Canvas); padding: 10px 12px;
  background: Canvas; color: CanvasText;
}
button { margin-top: 12px; cursor: pointer; border-color: color-mix(in srgb, CanvasText 40%, Canvas); }
a { color: inherit; }
</style>
</head>
<body><main>${body}</main></body>
</html>`

const message = (title, text) => page(title, `<h1>${title}</h1><p>${text}</p><p><a href="/">Go to Ackee</a></p>`)

// The same wording for every failure the user can do nothing about, and a clear one for
// the mistake they can: following a link twice.
const explain = (status) => {
  if (status === 'USED') return ['Link already used', 'This link works once. Ask for a new one if you still need it.']
  if (status === 'EXPIRED') return ['Link expired', 'Links are valid for a day. Ask for a new one.']

  return ['Link not valid', 'Check that you copied the whole address from the email.']
}

const router = express.Router()

router.get('/verify', async (request, response) => {
  const result = await userTokens.redeem(String(request.query.token ?? ''), 'VERIFY')

  if (result.status !== 'OK') {
    const [title, text] = explain(result.status)

    return response.status(400).send(message(title, text))
  }

  await users.verify(result.userId)

  response.send(message('Address confirmed', 'Your account is ready. You can sign in now.'))
})

export default router
