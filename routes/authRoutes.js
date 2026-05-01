import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Cooperator from "../models/Cooperator.js";
import Account from "../models/Account.js";
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
    // UPDATED: Extract fileNumber instead of email from the frontend request
    const { fileNumber, password } = req.body;

    // UPDATED: Search the database using the fileNumber
    const user = await Cooperator.findOne({ fileNumber }).select("+password");
    if (!user)
      return res
        .status(400)
        .json({
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
    const users = await Cooperator.find().select("-password").sort({ createdAt: -1 });
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
// @desc    Update user profile details
// @access  Private (Logged in users only)
router.put("/profile", protect, async (req, res) => {
  try {
    const user = await Cooperator.findById(req.user._id);

    if (user) {
      user.firstName = req.body.firstName || user.firstName;
      user.lastName = req.body.lastName || user.lastName;
      user.otherName = req.body.otherName || user.otherName;
      user.email = req.body.email || user.email;
      
      // Avatar placeholder (Phase 2 will use AWS S3/Cloudinary for actual file uploads)
      if (req.body.avatarUrl) {
        user.avatarUrl = req.body.avatarUrl;
      }

      const updatedUser = await user.save();

      // Return the updated user (excluding password)
      res.json({
        _id: updatedUser._id,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        otherName: updatedUser.otherName,
        email: updatedUser.email,
        fileNumber: updatedUser.fileNumber,
        role: updatedUser.role,
        avatarUrl: updatedUser.avatarUrl,
      });
    } else {
      res.status(404).json({ message: "User not found" });
    }
  } catch (error) {
    console.error("Profile Update Error:", error);
    res.status(500).json({ message: "Server error updating profile" });
  }
});

export default router;
