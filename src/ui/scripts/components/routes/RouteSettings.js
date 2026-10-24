import PropTypes from 'prop-types'
import { Fragment, createElement as h } from 'react'

import { homepage, version } from '../../../../../package.json'
import useDomains from '../../api/hooks/domains/useDomains.js'
import useWorkspaces from '../../api/hooks/members/useWorkspaces.js'
import useEvents from '../../api/hooks/events/useEvents.js'
import usePermanentTokens from '../../api/hooks/permanentTokens/usePermanentTokens.js'
import useDeleteToken from '../../api/hooks/tokens/useDeleteToken.js'
import {
  MODALS_DOMAIN_ADD,
  MODALS_DOMAIN_EDIT,
  MODALS_EVENT_ADD,
  MODALS_EVENT_EDIT,
  MODALS_PERMANENT_TOKEN_ADD,
  MODALS_PERMANENT_TOKEN_EDIT,
} from '../../constants/modals.js'

import CardMembers from '../cards/CardMembers.js'
import CardSetting from '../cards/CardSetting.js'
import Line from '../Line.js'
import LinkItem from '../LinkItem.js'
import Message from '../Message.js'

const LoadingMessage = (props) => {
  return h(Message, { status: 'warning' }, `Loading ${props.label}...`)
}

const RouteSettings = (props) => {
  const deleteToken = useDeleteToken()

  const domains = useDomains()
  const events = useEvents()
  const permanentTokens = usePermanentTokens()
  const workspaces = useWorkspaces()

  const onSignOut = async () => {
    await deleteToken.mutate({
      variables: {
        id: props.token,
      },
    })
    props.reset()
  }

  const createItems = (items, editFn, createFn, createLabel) => [
    ...items.flatMap((item) => [
      h(
        LinkItem,
        {
          type: 'button',
          text: item.id,
          onClick: () => editFn(item),
        },
        item.title,
      ),
      h(Line),
    ]),
    h(LinkItem, { type: 'button', onClick: createFn }, createLabel),
  ]

  const showDomainAddModal = () => props.addModal(MODALS_DOMAIN_ADD)
  const showDomainEditModal = (domain) => props.addModal(MODALS_DOMAIN_EDIT, domain)
  const showEventAddModal = () => props.addModal(MODALS_EVENT_ADD)
  const showEventEditModal = (event) => props.addModal(MODALS_EVENT_EDIT, event)
  const showPermanentTokenAddModal = () => props.addModal(MODALS_PERMANENT_TOKEN_ADD)
  const showPermanentTokenEditModal = (permanentToken) => props.addModal(MODALS_PERMANENT_TOKEN_EDIT, permanentToken)

  const domainsLoading = h(LoadingMessage, { label: 'domains' })
  const eventsLoading = h(LoadingMessage, { label: 'events' })
  const permanentTokensLoading = h(LoadingMessage, { label: 'permanent tokens' })

  const domainsItems = createItems(domains.value, showDomainEditModal, showDomainAddModal, 'New domain')
  const eventsItems = createItems(events.value, showEventEditModal, showEventAddModal, 'New event')
  const permanentTokensItems = createItems(
    permanentTokens.value,
    showPermanentTokenEditModal,
    showPermanentTokenAddModal,
    'New permanent token',
  )

  return h(
    Fragment,
    {},

    h(
      CardSetting,
      {
        headline: 'Account',
      },
      h(LinkItem, { type: 'p', disabled: true, text: version }, 'Version'),
      h(Line),
      h(LinkItem, { type: 'button', onClick: onSignOut }, 'Sign Out'),
    ),

    h(
      CardSetting,
      {
        headline: 'Domains',
      },
      ...(domains.status.isInitializing === true ? [domainsLoading] : domainsItems),
    ),

    h(
      CardSetting,
      {
        headline: 'Events',
      },
      ...(events.status.isInitializing === true ? [eventsLoading] : eventsItems),
    ),

    ...workspaces.value
      .filter((workspace) => workspace.canManageMembers === true)
      .map((workspace) => h(CardMembers, { key: workspace.id, workspace, addModal: props.addModal })),

    h(
      CardSetting,
      {
        headline: 'Permanent Tokens',
      },
      ...(permanentTokens.status.isInitializing === true ? [permanentTokensLoading] : permanentTokensItems),
    ),

    h(
      CardSetting,
      {
        headline: 'Donate',
      },
      h(
        LinkItem,
        { type: 'a', href: 'https://github.com/sponsors/electerious', target: '_blank', rel: 'noopener' },
        'Become a GitHub sponsor',
      ),
      h(Line),
      h(
        LinkItem,
        { type: 'a', href: 'https://www.buymeacoffee.com/electerious', target: '_blank', rel: 'noopener' },
        'Buy me a coffee',
      ),
      h(Line),
      h(
        LinkItem,
        { type: 'a', href: 'https://paypal.me/electerious', target: '_blank', rel: 'noopener' },
        'Donate via PayPal',
      ),
    ),

    h(
      CardSetting,
      {
        headline: 'Help',
      },
      h(
        LinkItem,
        { type: 'a', href: 'https://ackee.electerious.com', target: '_blank', rel: 'noopener' },
        'Website and documentation',
      ),
      h(Line),
      h(LinkItem, { type: 'a', href: homepage, target: '_blank', rel: 'noopener' }, 'Ackee on GitHub'),
      h(Line),
      h(
        LinkItem,
        { type: 'a', href: 'https://github.com/electerious/ackee-tracker', target: '_blank', rel: 'noopener' },
        'Add Ackee to your sites',
      ),
    ),
  )
}

RouteSettings.propTypes = {
  reset: PropTypes.func.isRequired,
  token: PropTypes.string.isRequired,
  addModal: PropTypes.func.isRequired,
}

export default RouteSettings
