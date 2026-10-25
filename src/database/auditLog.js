import AuditLog from '../models/AuditLog.js'

const response = (entry) => ({
  id: entry.id,
  userId: entry.userId,
  email: entry.email,
  workspaceId: entry.workspaceId,
  action: entry.action,
  targetId: entry.targetId,
  details: entry.details,
  created: entry.created,
})

export const record = (viewer, workspaceId, action, targetId, details) => {
  return AuditLog.create({ userId: viewer.userId, email: viewer.email, workspaceId, action, targetId, details })
}

// Newest first, only from the given workspaces.
export const list = async (workspaceIds, limit) => {
  const entries = await AuditLog.find({ workspaceId: { $in: workspaceIds } })
    .sort({ created: -1 })
    .limit(limit)
    .lean()

  return entries.map(response)
}
