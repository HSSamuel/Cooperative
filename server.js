import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";

import authRoutes from "./routes/authRoutes.js";
import accountRoutes from "./routes/accountRoutes.js";
import loanRoutes from "./routes/loanRoutes.js"; // <-- 1. Import this

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/account", accountRoutes);
app.use("/api/loans", loanRoutes); // <-- 2. Register this

app.get("/", (req, res) => {
  res.send("ASCON Cooperative Backend is running!");
});

mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log("✅ Connected to MongoDB successfully");
    app.listen(PORT, () => {
      console.log(`🚀 Server is listening on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("❌ Error connecting to MongoDB:", error.message);
  });
