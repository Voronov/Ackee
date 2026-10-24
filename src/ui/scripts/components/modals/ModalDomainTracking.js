import PropTypes from 'prop-types'
import { createElement as h, useEffect, useState } from 'react'

import useDomainTracking, { useUpdateDomainTracking } from '../../api/hooks/domains/useDomainTracking.js'
import commonModalProps from '../../utils/commonModalProps.js'
import shortId from '../../utils/shortId.js'

import Input from '../Input.js'
import Label from '../Label.js'
import Message from '../Message.js'
import Select from '../Select.js'
import Spacer from '../Spacer.js'
import Spinner from '../Spinner.js'
import Text from '../Text.js'

const TYPES = [
  { value: 'CLICK', label: 'Click' },
  { value: 'VISIBLE', label: 'Seen' },
  { value: 'FORM', label: 'Form sent' },
]

const SWITCHES = [
  ['outbound', 'Links to other sites'],
  ['downloads', 'File downloads'],
  ['scroll', 'Scroll depth: 25, 50, 75 and 100 %'],
  ['vitals', 'Page speed: LCP, INP and CLS'],
]

const blankRule = () => ({ key: shortId(), type: 'CLICK', selector: '', label: '', path: '' })

// What the site collects besides page views, without touching its code (ACKEE-25). The site
// needs the snippet with /t/<id>.js once; every change here reaches it within a minute.
const ModalDomainTracking = (props) => {
  const tracking = useDomainTracking(props.id)
  const update = useUpdateDomainTracking(props.id)
  const [form, setForm] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (tracking.value == null || form != null) return
    const { downloadExtensions, rules, ...rest } = tracking.value
    setForm({
      ...rest,
      extensions: downloadExtensions.join(', '),
      rules: rules.map((rule) => ({ ...rule, key: rule.id })),
    })
  }, [tracking.value, form])

  if (form == null) return h('div', { className: 'card' }, h('div', { className: 'card__inner' }, h(Spinner)))

  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value })
  const toggle = (key) => () => setForm({ ...form, [key]: !form[key] })
  const setRule = (key, field) => (event) =>
    setForm({
      ...form,
      rules: form.rules.map((rule) => (rule.key === key ? { ...rule, [field]: event.target.value } : rule)),
    })
  const removeRule = (key) => () => setForm({ ...form, rules: form.rules.filter((rule) => rule.key !== key) })
  const addRule = () => setForm({ ...form, rules: [...form.rules, blankRule()] })

  const onSubmit = async (event) => {
    event.preventDefault()
    setError(null)

    try {
      await update.save({
        gtmId: form.gtmId.trim(),
        outbound: form.outbound,
        downloads: form.downloads,
        downloadExtensions: form.extensions
          .split(',')
          .map((extension) => extension.trim().replace(/^\./, '').toLowerCase())
          .filter(Boolean),
        scroll: form.scroll,
        vitals: form.vitals,
        rules: form.rules.map(({ id, type, selector, label, path }) => ({ id, type, selector, label, path })),
      })
      props.closeModal()
    } catch (error_) {
      setError(error_.message)
    }
  }

  const gtmId = shortId()
  const extensionsId = shortId()

  return h(
    'form',
    { className: 'card', onSubmit },
    h(
      'div',
      { className: 'card__inner' },
      h(Spacer, { size: 0.5 }),
      h(Text, { type: 'p', className: 'color-secondary' }, `What ${props.title} collects besides page views.`),

      h(Label, { htmlFor: gtmId }, 'Google Tag Manager container'),
      h(Input, {
        type: 'text',
        id: gtmId,
        placeholder: 'GTM-ABC1234 (optional)',
        value: form.gtmId,
        onChange: set('gtmId'),
      }),

      h(Label, {}, 'Collect without any setup'),
      ...SWITCHES.map(([key, label]) =>
        h(
          'label',
          { key, className: 'checkbox' },
          h('input', { type: 'checkbox', checked: form[key], onChange: toggle(key) }),
          ` ${label}`,
        ),
      ),
      form.downloads === true && h(Label, { htmlFor: extensionsId }, 'File types that count as a download'),
      form.downloads === true &&
        h(Input, { type: 'text', id: extensionsId, value: form.extensions, onChange: set('extensions') }),

      h(Label, {}, 'Rules: a CSS selector, a name for the report, and the pages (empty for all, * for anything)'),
      ...form.rules.map((rule) =>
        h(
          'div',
          { key: rule.key, className: 'trackingRule' },
          h(Select, { value: rule.type, items: TYPES, onChange: setRule(rule.key, 'type') }),
          h(Input, {
            type: 'text',
            placeholder: '#buy or .pricing',
            value: rule.selector,
            onChange: setRule(rule.key, 'selector'),
          }),
          h(Input, { type: 'text', placeholder: 'Name', value: rule.label, onChange: setRule(rule.key, 'label') }),
          h(Input, { type: 'text', placeholder: '/product/*', value: rule.path, onChange: setRule(rule.key, 'path') }),
          h('button', { type: 'button', className: 'link color-destructive', onClick: removeRule(rule.key) }, 'Remove'),
        ),
      ),
      h('button', { type: 'button', className: 'link', onClick: addRule }, '+ Add rule'),

      error != null && h(Spacer, { size: 0.5 }),
      error != null && h(Message, { status: 'error' }, error),
    ),
    h(
      'div',
      { className: 'card__footer' },
      h('button', { type: 'button', className: 'card__button link', onClick: props.closeModal }, 'Close'),
      h('div', { className: 'card__separator' }),
      h(
        'button',
        { className: 'card__button card__button--primary link color-white', disabled: update.loading },
        update.loading ? h(Spinner) : 'Save',
      ),
    ),
  )
}

ModalDomainTracking.propTypes = {
  ...commonModalProps,
  id: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
}

export default ModalDomainTracking
