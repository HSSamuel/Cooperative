import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    cooperatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cooperator",
      required: true,
    },
    type: {
      type: String,
      enum: ["CREDIT", "DEBIT"], // CREDIT = Savings added, DEBIT = Savings withdrawn/loan deductions
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      validate: {
        validator: Number.isInteger,
        message: "Amount must be an integer (Kobo)",
      },
    },
    description: {
      type: String,
      required: true,
    },
    effectiveMonth: {
      type: String, // e.g., "October 2023"
    },
    balanceAfter: {
      type: Number,
      required: true, // Snapshot of the account balance after this transaction
    },
  },
  { timestamps: true },
);

export default mongoose.model("Transaction", transactionSchema);
