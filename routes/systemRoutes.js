import express from "express";
import SystemSetting from "../models/SystemSetting.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { logAdminAction } from "../utils/auditLogger.js";

const router = express.Router();

// Get settings (Creates default if none exist)
router.get("/settings", async (req, res) => {
  try {
    let settings = await SystemSetting.findOne();
    if (!settings) settings = await SystemSetting.create({});
    res.status(200).json({ settings });
  } catch (error) {
    res.status(500).json({ message: "Server error fetching settings" });
  }
});

// Update settings (Admin only)
router.put("/settings", protect, admin, async (req, res) => {
  try {
    let settings = await SystemSetting.findOne();
    if (!settings) settings = await SystemSetting.create({});

    settings.interestRate = req.body.interestRate ?? settings.interestRate;
    settings.creditMultiplier =
      req.body.creditMultiplier ?? settings.creditMultiplier;
    settings.maintenanceMode =
      req.body.maintenanceMode ?? settings.maintenanceMode;
    settings.allowRegistrations =
      req.body.allowRegistrations ?? settings.allowRegistrations;
    settings.loanFormFee = req.body.loanFormFee ?? settings.loanFormFee;

    await settings.save();

    logAdminAction(
      req.user.id || req.user._id,
      "UPDATED_SETTINGS",
      "Modified system global configurations.",
    );

    res
      .status(200)
      .json({ message: "Settings updated successfully", settings });
  } catch (error) {
    res.status(500).json({ message: "Server error updating settings" });
  }
});

export default router;
