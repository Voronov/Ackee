import { AUDIT_READ } from '../constants/permissions.js'
import * as auditLog from '../database/auditLog.js'
import requireAuth from '../middlewares/requireAuth.js'
import { workspacesWith } from '../utils/permissions.js'
import pipe from '../utils/pipe.js'

export default {
  Query: {
    // Filtered in the query itself: entries from other workspaces are never read.
    auditLog: pipe(requireAuth, (parent, { limit }, { viewer }) => {
      return auditLog.list(workspacesWith(viewer, AUDIT_READ), Math.min(Math.max(limit, 1), 500))
    }),
  },
}
