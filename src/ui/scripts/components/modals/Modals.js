import PropTypes from 'prop-types'
import { createElement as h } from 'react'

import * as modals from '../../constants/modals.js'

import Modal from './Modal.js'
import ModalDomainAdd from './ModalDomainAdd.js'
import ModalDomainEdit from './ModalDomainEdit.js'
import ModalDomainGa4 from './ModalDomainGa4.js'
import ModalDomainTracking from './ModalDomainTracking.js'
import ModalDurations from './ModalDurations.js'
import ModalEventAdd from './ModalEventAdd.js'
import ModalEventEdit from './ModalEventEdit.js'
import ModalMemberInvite from './ModalMemberInvite.js'
import ModalPermanentTokenAdd from './ModalPermanentTokenAdd.js'
import ModalPermanentTokenEdit from './ModalPermanentTokenEdit.js'
import ModalViews from './ModalViews.js'

const modalComponents = {
  [modals.MODALS_VIEWS]: ModalViews,
  [modals.MODALS_DURATIONS]: ModalDurations,
  [modals.MODALS_DOMAIN_ADD]: ModalDomainAdd,
  [modals.MODALS_DOMAIN_EDIT]: ModalDomainEdit,
  [modals.MODALS_DOMAIN_GA4]: ModalDomainGa4,
  [modals.MODALS_DOMAIN_TRACKING]: ModalDomainTracking,
  [modals.MODALS_EVENT_ADD]: ModalEventAdd,
  [modals.MODALS_EVENT_EDIT]: ModalEventEdit,
  [modals.MODALS_PERMANENT_TOKEN_ADD]: ModalPermanentTokenAdd,
  [modals.MODALS_PERMANENT_TOKEN_EDIT]: ModalPermanentTokenEdit,
  [modals.MODALS_MEMBER_INVITE]: ModalMemberInvite,
}

const Modals = (props) => {
  return Object.entries(props.modals).map(([modalId, modalData], index, modals) => {
    const current = modals.length - 1 === index
    const closeModal = props.removeModal.bind(null, modalId)

    const commonProps = {
      current,
      closeModal,
    }

    // A modal may open another one, like Google Analytics or the tracking rules from the domain
    const extraProps = { addModal: props.addModal }

    return h(
      Modal,
      { key: modalId, visible: true, ...commonProps },
      h(modalComponents[modalData.type], {
        ...commonProps,
        ...extraProps,
        ...modalData.props,
      }),
    )
  })
}

Modals.propTypes = {
  modals: PropTypes.object.isRequired,
  removeModal: PropTypes.func.isRequired,
  addModal: PropTypes.func,
}

export default Modals
