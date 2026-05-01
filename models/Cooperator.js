import mongoose from "mongoose";

const cooperatorSchema = new mongoose.Schema(
  {
    fileNumber: {
      type: String,
      required: true,
      unique: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    firstName: {
      type: String,
      required: true,
    },
    lastName: {
      type: String,
      required: true,
    },
    otherName: {
      type: String,
      required: false,
    },
    role: {
      type: String,
      enum: ["COOPERATOR", "ADMIN", "SUPER_ADMIN"],
      default: "COOPERATOR",
    },
    dateJoined: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

export default mongoose.model("Cooperator", cooperatorSchema);
