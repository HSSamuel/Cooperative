import express from "express";
import http from "http"; // Built into Node
import { Server } from "socket.io";
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

// 1. Create the HTTP server wrapper for Socket.io
const server = http.createServer(app);

// 2. Initialize Socket.io with CORS allowing your frontend
const io = new Server(server, {
  cors: {
    origin: process.env.NEXT_PUBLIC_FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST", "PUT"],
  },
});

// 3. Make 'io' globally accessible to your routes
app.set("io", io);

// 4. The Live Connection Map
// We map database User IDs to active Socket IDs so we can target specific people
const onlineUsers = new Map();

// 🚀 THE CRITICAL FIX: Make the map accessible to your routes
app.set("onlineUsers", onlineUsers);

io.on("connection", (socket) => {
  console.log("Live connection established:", socket.id);

  // When a user logs in, they send their ID to the server
  socket.on("register_user", (userId) => {
    onlineUsers.set(userId, socket.id);
  });

  socket.on("disconnect", () => {
    // Remove them from the map when they close the tab
    for (let [userId, socketId] of onlineUsers.entries()) {
      if (socketId === socket.id) {
        onlineUsers.delete(userId);
        break;
      }
    }
  });
});

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
    // 🚀 UPDATED: Make sure to listen on the 'server' (HTTP + Socket), not 'app'
    server.listen(PORT, () => {
      console.log(
        `🚀 Server is listening on port ${PORT} with Live WebSockets`,
      );
      console.log(`🌐 Allowed Frontend: https://asconcooperative.netlify.app`);
    });
  })
  .catch((error) => {
    console.error("❌ Error connecting to MongoDB:", error.message);
  });
