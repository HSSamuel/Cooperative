import AuditLog from "../models/AuditLog.js";

// We don't 'await' this in the main routes because we don't want
// a logging failure to crash a successful financial transaction.
export const logAdminAction = (
  adminId,
  action,
  description,
  targetId = null,
) => {
  AuditLog.create({ adminId, action, description, targetId }).catch((err) =>
    console.error("CRITICAL: Failed to write to Audit Log", err),
  );
};
