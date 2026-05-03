import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cooperator",
      required: true,
    },
    action: {
      type: String,
      required: true,
    }, // e.g., "APPROVED_LOAN", "UPDATED_ROLE"
    description: {
      type: String,
      required: true,
    }, // e.g., "Approved N500,000 loan for ASCON-042"
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
    }, // The ID of the affected user or loan
  },
  { timestamps: true },
);

export default mongoose.model("AuditLog", auditLogSchema);
