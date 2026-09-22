import KnownError from '../utils/KnownError.js'

// `viewer` is either the identified user or the reason identification failed. Throwing
// that reason keeps the old "Token missing" and "Token invalid" responses.
export default (parent, args, { viewer }) => {
  if (viewer instanceof KnownError) throw viewer
}
