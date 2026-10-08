import PropTypes from 'prop-types'
import { createElement as h, useState } from 'react'

import { homepage } from '../../../../../package.json'

import Headline from '../Headline.js'
import Input from '../Input.js'
import Message from '../Message.js'
import Spacer from '../Spacer.js'
import Spinner from '../Spinner.js'
import Text from '../Text.js'

import useCreateToken from '../../api/hooks/tokens/useCreateToken.js'
import useCreateUser from '../../api/hooks/users/useCreateUser.js'
import useRequestPasswordReset from '../../api/hooks/users/useRequestPasswordReset.js'
import useSignup from '../../api/hooks/users/useSignup.js'
import useInputs from '../../hooks/useInputs.js'

// One screen with three modes rather than three routes. The interface is a single page
// behind a hash router, and signing in is the only thing that happens before it loads.
const SIGN_IN = 'SIGN_IN'
const REGISTER = 'REGISTER'
const FORGOT = 'FORGOT'

const copy = {
  [SIGN_IN]: { lead: 'Welcome back, sign in to continue.', submit: 'Sign In →' },
  [REGISTER]: { lead: 'Create an account to start measuring your sites.', submit: 'Create account →' },
  [FORGOT]: { lead: 'We will email you a link to choose a new password.', submit: 'Send link →' },
}

const OverlayLogin = (props) => {
  const [mode, setMode] = useState(SIGN_IN)
  const [notice, setNotice] = useState(null)

  const signup = useSignup()
  const createToken = useCreateToken()
  const createUser = useCreateUser()
  const requestPasswordReset = useRequestPasswordReset()

  const current = { [SIGN_IN]: createToken, [REGISTER]: createUser, [FORGOT]: requestPasswordReset }[mode]

  const loading = current.loading === true
  const hasError = current.error != null

  const [inputs, onInputChange] = useInputs({
    username: globalThis.env.isDemoMode === true ? 'admin' : '',
    password: globalThis.env.isDemoMode === true ? '123456' : '',
  })

  const switchTo = (next) => (event) => {
    event.preventDefault()
    setNotice(null)
    setMode(next)
  }

  const onSubmit = async (event) => {
    event.preventDefault()
    setNotice(null)

    if (mode === SIGN_IN) {
      const { data } = await createToken.mutate({ variables: { input: inputs } })
      return props.setToken(data.createToken.payload.id)
    }

    if (mode === REGISTER) {
      const { data } = await createUser.mutate({
        variables: { input: { email: inputs.username, password: inputs.password } },
      })

      // With outgoing mail configured the account waits for a confirmation link, so
      // signing in straight away would fail. Without it the account is ready at once.
      if (data.createUser.payload.verified === true) {
        const signedIn = await createToken.mutate({ variables: { input: inputs } })
        return props.setToken(signedIn.data.createToken.payload.id)
      }

      setMode(SIGN_IN)
      return setNotice('Account created. Check your email for a confirmation link.')
    }

    await requestPasswordReset.mutate({ variables: { email: inputs.username } })
    setMode(SIGN_IN)

    // The same answer whether or not the address exists, so the form cannot be used to
    // find out who has an account here.
    setNotice('If that address has an account, a link is on its way.')
  }

  const link = (label, target) =>
    h('a', { className: 'card__button link', href: '#', onClick: switchTo(target) }, label)

  return h(
    'form',
    { className: 'card card--overlay', onSubmit },
    h(
      'div',
      { className: 'card__inner align-center' },

      h(Spacer, { size: 2.4 }),
      h(Headline, { type: 'h1' }, 'Ackee'),
      h(Text, { type: 'p' }, copy[mode].lead),
      h(Spacer, { size: 2.5 }),

      notice != null && h(Message, { status: 'success' }, notice),
      hasError === true && h(Message, { status: 'error' }, current.error.message),

      h(Input, {
        type: 'username',
        required: true,
        disabled: loading === true,
        focused: true,
        placeholder: mode === SIGN_IN ? 'Email' : 'Email address',
        value: inputs.username,
        onChange: onInputChange('username'),
      }),

      mode !== FORGOT &&
        h(Input, {
          type: 'password',
          required: true,
          disabled: loading === true,
          placeholder: mode === REGISTER ? 'Password, at least 10 characters' : 'Password',
          value: inputs.password,
          onChange: onInputChange('password'),
        }),

      h(Spacer, { size: 1 }),
    ),
    h(
      'div',
      { className: 'card__footer' },

      mode === SIGN_IN && signup.allowed === true && link('Create account', REGISTER),
      mode === SIGN_IN && link('Forgot password', FORGOT),
      mode !== SIGN_IN && link('← Back to sign in', SIGN_IN),
      mode === SIGN_IN &&
        signup.allowed === false &&
        h('a', { className: 'card__button link', href: homepage, target: '_blank', rel: 'noopener' }, 'Help'),

      h('div', { className: 'card__separator' }),

      h(
        'button',
        {
          className: 'card__button card__button--primary link color-white',
          disabled: loading === true,
        },
        loading === true ? h(Spinner) : copy[mode].submit,
      ),
    ),
  )
}

OverlayLogin.propTypes = {
  setToken: PropTypes.func.isRequired,
}

export default OverlayLogin
