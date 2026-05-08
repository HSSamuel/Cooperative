import mongoose from "mongoose";

const loanSchema = new mongoose.Schema(
  {
    cooperatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cooperator",
      required: true,
    },
    amountRequested: {
      type: Number,
      required: true,
    },
    loanType: {
      type: String,
      enum: ["REGULAR", "EMERGENCY", "COMMODITY", "EQUIPMENT"],
      default: "REGULAR",
    },
    // Repayment Tenure in Months
    tenure: {
      type: Number,
      default: 10,
    },
    // The Business Model (Interest)
    interestRate: {
      type: Number,
      default: 10, // 🚀 NEW DEFAULT: 10% interest rate
    },
    amountDue: {
      type: Number,
      required: false, // Principal + Interest (false to support old test loans)
    },
    amountRepaid: {
      type: Number,
      default: 0,
    },
    guarantor1: {
      cooperatorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Cooperator",
        required: false,
      },
      status: {
        type: String,
        enum: ["PENDING", "ACCEPTED", "DECLINED"],
        default: "PENDING",
      },
    },
    guarantor2: {
      cooperatorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Cooperator",
        required: false,
      },
      status: {
        type: String,
        enum: ["PENDING", "ACCEPTED", "DECLINED"],
        default: "PENDING",
      },
    },
    status: {
      type: String,
      enum: [
        "PENDING_GUARANTORS",
        "PENDING_ADMIN",
        "APPROVED",
        "REJECTED",
        "REPAID",
      ],
      default: "PENDING_GUARANTORS",
    },
    adminComment: {
      type: String,
      default: "",
    },
  },
  { timestamps: true },
);

export default mongoose.model("Loan", loanSchema);
