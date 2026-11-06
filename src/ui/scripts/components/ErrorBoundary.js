import { Component, createElement as h } from 'react'

import OverlayFailure from './overlays/OverlayFailure.js'

const ErrorBoundary = class extends Component {
  constructor(props) {
    super(props)
    this.state = { error: undefined }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    const hasError = this.state.error != null
    if (hasError === true) {
      return h(OverlayFailure, {
        errors: [this.state.error],
      })
    }

    return this.props.children
  }
}

export default ErrorBoundary
