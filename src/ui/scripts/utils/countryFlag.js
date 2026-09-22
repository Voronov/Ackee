// Turns a two-letter code into the flag for that country. The regional indicator letters
// live 127397 above the Latin ones, so the flag is the code written in that alphabet.
export default (code) => {
  if (typeof code !== 'string' || code.length !== 2) return ''

  return String.fromCodePoint(...[...code.toUpperCase()].map((letter) => letter.codePointAt(0) + 127_397))
}
