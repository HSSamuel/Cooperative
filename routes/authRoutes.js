import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { sendPasswordResetEmail } from "../utils/emailService.js";
import Cooperator from "../models/Cooperator.js";
import Account from "../models/Account.js";
import AuditLog from "../models/AuditLog.js";
import Notification from "../models/Notification.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/register", async (req, res) => {
  try {
    const { fileNumber, email, password, firstName, lastName, otherName } =
      req.body;

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

    const newAccount = new Account({
      cooperatorId: savedCooperator._id,
      totalSavings: 0,
      availableCreditLimit: 0,
    });
    await newAccount.save();

    await Notification.create({
      user: savedCooperator._id,
      title: "Welcome to ASCON Coop!",
      message:
        "Your cooperative account has been successfully created. You can now start tracking your savings.",
      type: "success",
    });

    res.status(201).json({
      message: "Cooperator registered successfully",
      cooperatorId: savedCooperator._id,
    });
  } catch (error) {
    console.error("Registration Error:", error);
    res.status(500).json({ message: "Server error during registration" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { fileNumber, password } = req.body;

    const user = await Cooperator.findOne({ fileNumber }).select("+password");
    if (!user)
      return res.status(400).json({
        message: "Invalid credentials. Please check your ASCON File Number.",
      });

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

    // 🚀 FIX: Cross-Domain Cookie Configuration
    res.cookie("coop_token", token, {
      httpOnly: true,
      secure: true, // MUST be true for cross-site cookies
      sameSite: "none", // MUST be "none" to allow Netlify to send the cookie to Render
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    });

    res.status(200).json({
      message: "Login successful",
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        otherName: user.otherName,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
        fileNumber: user.fileNumber,
        gender: user.gender,
        birthday: user.birthday,
        mobile: user.mobile,
        occupation: user.occupation,
        dateJoined: user.dateJoined || user.createdAt,
      },
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: "Server error during login" });
  }
});

// 🚀 NEW: Logout Route ensuring we target the exact same Cross-Domain configuration
router.post("/logout", (req, res) => {
  res.cookie("coop_token", "", {
    httpOnly: true,
    secure: true, // Must exactly match the login config to be destroyed
    sameSite: "none", // Must exactly match the login config to be destroyed
    expires: new Date(0), // Instantly expire the cookie
  });
  res.status(200).json({ message: "Logged out successfully" });
});

router.get("/all-members", async (req, res) => {
  try {
    const users = await Cooperator.find()
      .select("-password")
      .sort({ createdAt: -1 });
    res.status(200).json(users);
  } catch (error) {
    console.error("Fetch Users Error:", error);
    res.status(500).json({ message: "Server error fetching members" });
  }
});

router.put("/profile", protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const user = await Cooperator.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (req.body.firstName) user.firstName = req.body.firstName;
    if (req.body.lastName) user.lastName = req.body.lastName;
    if (req.body.otherName !== undefined) user.otherName = req.body.otherName;
    if (req.body.email) user.email = req.body.email;
    if (req.body.avatarUrl) user.avatarUrl = req.body.avatarUrl;

    if (req.body.gender !== undefined) user.gender = req.body.gender;
    if (req.body.birthday !== undefined) user.birthday = req.body.birthday;
    if (req.body.mobile !== undefined) user.mobile = req.body.mobile;
    if (req.body.occupation !== undefined)
      user.occupation = req.body.occupation;

    const updatedUser = await user.save();

    await Notification.create({
      user: updatedUser._id,
      title: "Profile Updated",
      message:
        "Your personal cooperative profile information was successfully updated.",
      type: "system",
    });

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");
    if (io && onlineUsers) {
      const userSocket = onlineUsers.get(updatedUser._id.toString());
      if (userSocket) io.to(userSocket).emit("update_notifications");
    }

    res.status(200).json({
      _id: updatedUser._id,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      otherName: updatedUser.otherName,
      email: updatedUser.email,
      fileNumber: updatedUser.fileNumber,
      role: updatedUser.role,
      avatarUrl: updatedUser.avatarUrl,
      gender: updatedUser.gender,
      birthday: updatedUser.birthday,
      mobile: updatedUser.mobile,
      occupation: updatedUser.occupation,
      dateJoined: updatedUser.dateJoined,
    });
  } catch (error) {
    console.error("Profile Update Error:", error);
    res.status(500).json({ message: "Server error updating profile" });
  }
});

router.put("/update-password", protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id || req.user._id;
    let user = await Cooperator.findById(userId).select("+password");

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

    await Notification.create({
      user: user._id,
      title: "Security Alert: Password Changed",
      message:
        "Your account password was successfully changed. If this wasn't you, contact Admin immediately.",
      type: "danger",
    });

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");
    if (io && onlineUsers) {
      const userSocket = onlineUsers.get(user._id.toString());
      if (userSocket) io.to(userSocket).emit("update_notifications");
    }

    res.status(200).json({ message: "Password updated successfully." });
  } catch (error) {
    console.error("Password Update Error:", error);
    res.status(500).json({ message: "Server error updating password." });
  }
});

router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await Cooperator.findOne({ email });

    if (!user) {
      return res.status(200).json({
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
      res.status(200).json({
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

    await Notification.create({
      user: user._id,
      title: "Password Successfully Recovered",
      message: "You used a recovery link to reset your password.",
      type: "system",
    });

    res
      .status(200)
      .json({ message: "Password successfully reset. You can now log in." });
  } catch (error) {
    console.error("Reset Password Error:", error);
    res.status(500).json({ message: "Server error resetting password." });
  }
});

router.get("/audit-logs", protect, async (req, res) => {
  try {
    if (req.user.role !== "ADMIN" && req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Not authorized. Admins only." });
    }

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
