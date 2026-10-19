// Prints a session token for ../bench/run.sh: node tools/spike-15/token.js <url> <username> <password>
import { login } from './api.js'

const [url, username, password] = process.argv.slice(2)

if (password == null) throw new Error('Usage: token.js <url> <username> <password>')

process.stdout.write(`${await login(url, username, password)}\n`)
