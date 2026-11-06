import { createHashHistory } from 'history'

// One history for the router and the filters of the dashboard, which live in the same address.
// Made on first use, so modules that import it also load where there is no document (tests).
let instance

export default () => {
  instance ??= createHashHistory()
  return instance
}
