import mongoose from "mongoose";

const cooperatorSchema = new mongoose.Schema(
  {
    fileNumber: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: {
      type: String,
      required: true,
      select: false,
      resetPasswordToken: String,
      resetPasswordExpire: Date,
    },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    otherName: { type: String, required: false },

    // 🚀 NEW BIO DATA FIELDS
    gender: {
      type: String,
      enum: ["Male", "Female", "Other", ""],
      default: "",
    },
    birthday: { type: Date },
    mobile: { type: String, default: "" },
    occupation: { type: String, default: "Staff" },

    role: {
      type: String,
      enum: ["COOPERATOR", "ADMIN", "SUPER_ADMIN"],
      default: "COOPERATOR",
    },
    dateJoined: { type: Date, default: Date.now },
    avatarUrl: { type: String, default: "" },
  },
  { timestamps: true },
);

export default mongoose.model("Cooperator", cooperatorSchema);
