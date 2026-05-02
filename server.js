import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";

import authRoutes from "./routes/authRoutes.js";
import accountRoutes from "./routes/accountRoutes.js";
import loanRoutes from "./routes/loanRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";

dotenv.config();

const app = express();

// ==========================================
// MIDDLEWARE & SECURITY (THE HANDSHAKE)
// ==========================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS Policy: Explicitly allow your Netlify domain and local environment
app.use(
  cors({
    origin: ["http://localhost:3000", "https://asconcooperative.netlify.app"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

// ==========================================
// API ROUTES
// ==========================================
app.use("/api/auth", authRoutes);
app.use("/api/account", accountRoutes);
app.use("/api/loans", loanRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/notifications", notificationRoutes);

// Base Health Check Route
app.get("/", (req, res) => {
  res.status(200).json({
    message: "ASCON Cooperative API is Live 🚀",
    environment: process.env.NODE_ENV || "production",
  });
});

// ==========================================
// DATABASE CONNECTION & SERVER START
// ==========================================
mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log("✅ Connected to MongoDB successfully");
    app.listen(PORT, () => {
      console.log(`🚀 Server is listening on port ${PORT}`);
      console.log(`🌐 Allowed Frontend: https://asconcooperative.netlify.app`);
    });
  })
  .catch((error) => {
    console.error("❌ Error connecting to MongoDB:", error.message);
  });
