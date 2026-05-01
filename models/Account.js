import mongoose from "mongoose";

const accountSchema = new mongoose.Schema(
  {
    cooperatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cooperator",
      required: true,
      unique: true,
    },
    totalSavings: {
      type: Number,
      required: true,
      default: 0,
      validate: {
        validator: Number.isInteger,
        message: "totalSavings must be an integer (Kobo)",
      },
    },
    availableCreditLimit: {
      type: Number,
      required: true,
      default: 0,
      validate: {
        validator: Number.isInteger,
        message: "availableCreditLimit must be an integer (Kobo)",
      },
    },
  },
  { timestamps: true },
);

export default mongoose.model("Account", accountSchema);
