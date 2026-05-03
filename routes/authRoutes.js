import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { sendPasswordResetEmail } from "../utils/emailService.js";
import Cooperator from "../models/Cooperator.js";
import Account from "../models/Account.js";
import AuditLog from "../models/AuditLog.js"; // 🚀 NEW: Import Audit Model
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// ==========================================
// 1. REGISTER LOGIC
// ==========================================
router.post("/register", async (req, res) => {
  try {
    const { fileNumber, email, password, firstName, lastName, otherName } =
      req.body;

    // Check if a user with this file number OR email already exists
    const existingUser = await Cooperator.findOne({
      $or: [{ email }, { fileNumber }],
    });

    if (existingUser)
      return res.status(400).json({
        message: "User with this email or file number already exists",
      });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newCooperator = new Cooperator({
      fileNumber,
      email,
      password: hashedPassword,
      firstName,
      lastName,
      otherName,
    });
    const savedCooperator = await newCooperator.save();

    // Automatically create a blank financial account for the new user
    const newAccount = new Account({
      cooperatorId: savedCooperator._id,
      totalSavings: 0,
      availableCreditLimit: 0,
    });
    await newAccount.save();

    res.status(201).json({
      message: "Cooperator registered successfully",
      cooperatorId: savedCooperator._id,
    });
  } catch (error) {
    console.error("Registration Error:", error);
    res.status(500).json({ message: "Server error during registration" });
  }
});

// ==========================================
// 2. LOGIN LOGIC
// ==========================================
router.post("/login", async (req, res) => {
  try {
    // Extract fileNumber instead of email from the frontend request
    const { fileNumber, password } = req.body;

    // Search the database using the fileNumber
    const user = await Cooperator.findOne({ fileNumber }).select("+password");
    if (!user)
      return res.status(400).json({
        message: "Invalid credentials. Please check your ASCON File Number.",
      });

    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res
        .status(400)
        .json({ message: "Invalid credentials. Incorrect password." });

    const payload = {
      id: user._id,
      role: user.role,
      fileNumber: user.fileNumber,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        otherName: user.otherName,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
        fileNumber: user.fileNumber,
      },
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: "Server error during login" });
  }
});

// ==========================================
// 3. ALL MEMBERS
// ==========================================

// @route   GET /api/auth/all-members
// @desc    Get all registered cooperators (For Admin CRM)
router.get("/all-members", async (req, res) => {
  try {
    // Fetch all users but DO NOT send their passwords
    const users = await Cooperator.find()
      .select("-password")
      .sort({ createdAt: -1 });
    res.status(200).json(users);
  } catch (error) {
    console.error("Fetch Users Error:", error);
    res.status(500).json({ message: "Server error fetching members" });
  }
});

// ==========================================
// 4. UPDATE USER PROFILE
// ==========================================

// @route   PUT /api/auth/profile
// @desc    Update user profile (including avatar)
// @access  Private
router.put("/profile", protect, async (req, res) => {
  try {
    // 1. Grab the correct ID format
    const userId = req.user.id || req.user._id;

    // 2. Find the user
    const user = await Cooperator.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // 3. Update the fields if they were provided in the request
    if (req.body.firstName) user.firstName = req.body.firstName;
    if (req.body.lastName) user.lastName = req.body.lastName;
    if (req.body.otherName !== undefined) user.otherName = req.body.otherName;
    if (req.body.email) user.email = req.body.email;

    // Save the Cloudinary Avatar URL
    if (req.body.avatarUrl) user.avatarUrl = req.body.avatarUrl;

    // 4. Save to database
    const updatedUser = await user.save();

    // 5. Send back the updated user without the password
    res.status(200).json({
      _id: updatedUser._id,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      otherName: updatedUser.otherName,
      email: updatedUser.email,
      fileNumber: updatedUser.fileNumber,
      role: updatedUser.role,
      avatarUrl: updatedUser.avatarUrl,
    });
  } catch (error) {
    console.error("Profile Update Error:", error);
    res.status(500).json({ message: "Server error updating profile" });
  }
});

// @route   PUT /api/auth/update-password
// @desc    Update user password
// @access  Private
router.put("/update-password", protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const userId = req.user.id || req.user._id;

    let user = await Cooperator.findById(userId).select("+password");

    // Fallback if token uses fileNumber instead of ID
    if (!user && req.user.fileNumber) {
      user = await Cooperator.findOne({
        fileNumber: req.user.fileNumber,
      }).select("+password");
    }

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Incorrect current password." });
    }

    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({ message: "New password must be at least 6 characters." });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);

    await user.save();

    res.status(200).json({ message: "Password updated successfully." });
  } catch (error) {
    console.error("Password Update Error:", error);
    res.status(500).json({ message: "Server error updating password." });
  }
});

// ==========================================
// 5. PASSWORD RECOVERY SYSTEM
// ==========================================

// @route   POST /api/auth/forgot-password
// @desc    Generate reset token and send email
// @access  Public
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    const user = await Cooperator.findOne({ email });
    if (!user) {
      return res
        .status(200)
        .json({
          message: "If that email is registered, a reset link has been sent.",
        });
    }

    const resetToken = crypto.randomBytes(20).toString("hex");

    user.resetPasswordToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    user.resetPasswordExpire = Date.now() + 10 * 60 * 1000;
    await user.save();

    const resetUrl = `${process.env.NEXT_PUBLIC_FRONTEND_URL || "http://localhost:3000"}/reset-password/${resetToken}`;

    try {
      await sendPasswordResetEmail(user.email, user.firstName, resetUrl);
      res
        .status(200)
        .json({
          message: "If that email is registered, a reset link has been sent.",
        });
    } catch (emailError) {
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save();
      return res
        .status(500)
        .json({ message: "Email could not be sent. Please try again later." });
    }
  } catch (error) {
    console.error("Forgot Password Error:", error);
    res.status(500).json({ message: "Server error processing request." });
  }
});

// @route   PUT /api/auth/reset-password/:token
// @desc    Reset password using token
// @access  Public
router.put("/reset-password/:token", async (req, res) => {
  try {
    const resetPasswordToken = crypto
      .createHash("sha256")
      .update(req.params.token)
      .digest("hex");

    const user = await Cooperator.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res
        .status(400)
        .json({ message: "Invalid or expired password reset token." });
    }

    const { password } = req.body;
    if (!password || password.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters." });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);

    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    res
      .status(200)
      .json({ message: "Password successfully reset. You can now log in." });
  } catch (error) {
    console.error("Reset Password Error:", error);
    res.status(500).json({ message: "Server error resetting password." });
  }
});

// ==========================================
// 6. SYSTEM AUDIT ENGINE
// ==========================================

// 🚀 NEW: Route to fetch Audit Trails for the Command Center
// @route   GET /api/auth/audit-logs
// @desc    Get system audit logs (Admin only)
// @access  Private/Admin
router.get("/audit-logs", protect, async (req, res) => {
  try {
    // Ensure only admins can read the ledger
    if (req.user.role !== "ADMIN" && req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Not authorized. Admins only." });
    }

    // Fetch the 50 most recent immutable actions
    const logs = await AuditLog.find()
      .populate("adminId", "firstName lastName fileNumber")
      .sort({ createdAt: -1 })
      .limit(50);

    res.status(200).json(logs);
  } catch (error) {
    console.error("Audit Log Fetch Error:", error);
    res.status(500).json({ message: "Server error fetching audit logs." });
  }
});

export default router;
