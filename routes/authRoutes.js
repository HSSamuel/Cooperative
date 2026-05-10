import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { sendPasswordResetEmail } from "../utils/emailService.js";
import Cooperator from "../models/Cooperator.js";
import Account from "../models/Account.js";
import AuditLog from "../models/AuditLog.js";
import Notification from "../models/Notification.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

const registerSchema = z.object({
  body: z.object({
    fileNumber: z.string().min(3, "Valid ASCON File Number is required"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    otherName: z.string().optional(),
  }),
});

const loginSchema = z.object({
  body: z.object({
    fileNumber: z.string().min(3, "File Number is required"),
    password: z.string().min(1, "Password is required"),
  }),
});

router.post("/register", validate(registerSchema), async (req, res) => {
  try {
    const { fileNumber, email, password, firstName, lastName, otherName } =
      req.body;

    const normalizedFileNumber = fileNumber.replace(/\s+/g, "").toUpperCase();
    const normalizedEmail = email.replace(/\s+/g, "").toLowerCase();

    const existingUser = await Cooperator.findOne({
      $or: [{ email: normalizedEmail }, { fileNumber: normalizedFileNumber }],
    });

    if (existingUser)
      return res.status(400).json({
        message: "User with this email or file number already exists",
      });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newCooperator = new Cooperator({
      fileNumber: normalizedFileNumber,
      email: normalizedEmail,
      password: hashedPassword,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      otherName: otherName ? otherName.trim() : "",
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

router.post("/login", validate(loginSchema), async (req, res) => {
  try {
    const { fileNumber, password } = req.body;
    const normalizedFileNumber = fileNumber.replace(/\s+/g, "").toUpperCase();

    const user = await Cooperator.findOne({
      fileNumber: normalizedFileNumber,
    }).select("+password");
    if (!user) return res.status(400).json({ message: "Invalid credentials." });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ message: "Invalid credentials." });

    const payload = {
      id: user._id,
      role: user.role,
      fileNumber: user.fileNumber,
    };

    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "15m",
    });
    const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
      expiresIn: "7d",
    });

    const isProduction = process.env.NODE_ENV === "production";

    res.cookie("coop_token", accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      maxAge: 15 * 60 * 1000,
    });

    res.cookie("coop_refresh_token", refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      message: "Login successful",
      token: accessToken,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        fileNumber: user.fileNumber,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error during login" });
  }
});

router.post("/logout", (req, res) => {
  const isProduction = process.env.NODE_ENV === "production";

  res.cookie("coop_token", "", {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    expires: new Date(0),
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
    const user = await Cooperator.findOne({
      email: email.trim().toLowerCase(),
    });

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

    // Fire-and-forget the email. Do not await it!
    sendPasswordResetEmail(user.email, user.firstName, resetUrl).catch(
      (emailError) =>
        console.error("Non-fatal: Password reset email failed.", emailError),
    );

    // Immediately resolve the HTTP request
    res.status(200).json({
      message: "If that email is registered, a reset link has been sent.",
    });
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

router.post("/refresh", async (req, res) => {
  try {
    const refreshToken = req.cookies.coop_refresh_token;

    if (!refreshToken) {
      return res
        .status(401)
        .json({ message: "Session expired. Please log in again." });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    const payload = {
      id: decoded.id,
      role: decoded.role,
      fileNumber: decoded.fileNumber,
    };
    const newAccessToken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "15m",
    });

    const isProduction = process.env.NODE_ENV === "production";

    res.cookie("coop_token", newAccessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      maxAge: 15 * 60 * 1000,
    });

    res.status(200).json({ token: newAccessToken });
  } catch (error) {
    console.error("Token refresh failed:", error.message);
    res.status(401).json({ message: "Invalid refresh token. Please log in." });
  }
});

export default router;