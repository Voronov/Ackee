import { createHash } from 'node:crypto'

const hashOf = (code) => `'sha256-${createHash('sha256').update(code).digest('base64')}'`

// Reads pages Ackee writes itself, where an inline script is always a plain <script> tag
const inlineScripts = (html) =>
  html
    .split('<script>')
    .slice(1)
    .map((part) => hashOf(part.split('</script>')[0]))

// The UI is one static file, so hashes allow its inline scripts and nothing injected later.
// Styles stay inline: React sets style attributes and the pages of src/pages.js have a style tag.
// Without the defaults, as upgrade-insecure-requests would break an instance served over http.
export const directivesFor = (html) => ({
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", ...inlineScripts(html)],
  scriptSrcAttr: ["'none'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:'],
  fontSrc: ["'self'", 'data:'],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'self'"],
})

// For a page made per request, whose only job is its own inline script
export const scriptOnlyPolicy = (html) => `default-src 'none'; script-src ${inlineScripts(html).join(' ')}`
