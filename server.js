import express from "express";
import http from "http";
import { Server } from "socket.io";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser"; // 🚀 REQUIRED FOR COOKIES

import authRoutes from "./routes/authRoutes.js";
import accountRoutes from "./routes/accountRoutes.js";
import loanRoutes from "./routes/loanRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";

dotenv.config();

const app = express();
const server = http.createServer(app);

// 🚀 FIX: Ensure WebSockets allow Cross-Domain Credentials (Cookies)
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "https://asconcooperative.netlify.app"],
    methods: ["GET", "POST", "PUT"],
    credentials: true, // MUST BE TRUE
  },
});

app.set("io", io);

const onlineUsers = new Map();
app.set("onlineUsers", onlineUsers);

io.on("connection", (socket) => {
  console.log("Live connection established:", socket.id);

  socket.on("register_user", (userId) => {
    onlineUsers.set(userId, socket.id);
  });

  socket.on("disconnect", () => {
    for (let [userId, socketId] of onlineUsers.entries()) {
      if (socketId === socket.id) {
        onlineUsers.delete(userId);
        break;
      }
    }
  });
});

// ==========================================
// MIDDLEWARE & SECURITY
// ==========================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // 🚀 MOUNTS THE COOKIE PARSER

// 🚀 FIX: Ensure Express allows Cross-Domain Credentials (Cookies)
app.use(
  cors({
    origin: ["http://localhost:3000", "https://asconcooperative.netlify.app"],
    credentials: true, // MUST BE TRUE
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
