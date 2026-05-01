import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import mongoose from "mongoose";

// Import Routes
import authRoutes from "./routes/authRoutes.js";
import loansRoutes from "./routes/loansRoutes.js";
import accountRoutes from "./routes/accountRoutes.js";

// Load Environment Variables
dotenv.config();

// Initialize Express App
const app = express();

// ==========================================
// MIDDLEWARE & SECURITY (THE HANDSHAKE)
// ==========================================
app.use(express.json()); // Allows the server to accept JSON data in req.body
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

// ==========================================
// DATABASE CONNECTION (THE VAULT)
// ==========================================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Atlas Connected Successfully"))
  .catch((error) => {
    console.error("❌ MongoDB Connection Error:", error.message);
    process.exit(1); // Stop the server if the database fails to connect
  });

// ==========================================
// API ROUTES
// ==========================================
// 1. Identity & Auth (Login, Register, Directory, Profile Update)
app.use("/api/auth", authRoutes);

// 2. Ledger & Loans (Requests, Reviews, Payroll Export)
app.use("/api/loans", loansRoutes);

// 3. Financial Controls (User Balances, Admin Adjustments)
app.use("/api/account", accountRoutes);

// Base Health Check Route (To verify the API is alive on Render)
app.get("/", (req, res) => {
  res.status(200).json({
    message: "ASCON Cooperative API is Live 🚀",
    environment: process.env.NODE_ENV || "development",
  });
});

// ==========================================
// SERVER INITIALIZATION
// ==========================================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Allowed Frontend: https://asconcooperative.netlify.app`);
});
