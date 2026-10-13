import { DEFAULT_WORKSPACE_ID } from '../constants/workspaces.js'
import KnownError from '../utils/KnownError.js'
import { can } from '../utils/permissions.js'

// Runs after `requireAuth`. `workspaceOf` names the workspace the request touches.
export default (permission, workspaceOf = () => DEFAULT_WORKSPACE_ID) =>
  async (parent, args, { viewer }) => {
    if (can(viewer, permission, await workspaceOf(parent, args)) === false) {
      throw new KnownError('You do not have permission to do this')
    }
  }
