import mongoose from "mongoose";

const systemSettingSchema = new mongoose.Schema(
  {
    interestRate: { type: Number, default: 10.0 },
    creditMultiplier: { type: Number, default: 2.0 },
    maintenanceMode: { type: Boolean, default: false },
    allowRegistrations: { type: Boolean, default: true },
    loanFormFee: { type: Number, default: 50000 }, // 🚀 ADDED: Form fee in Kobo
  },
  { timestamps: true },
);

export default mongoose.model("SystemSetting", systemSettingSchema);
