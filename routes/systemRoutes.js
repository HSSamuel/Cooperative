import express from "express";
import SystemSetting from "../models/SystemSetting.js";
import {
  protect,
  admin,
  clearSettingsCache,
} from "../middleware/authMiddleware.js";
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

    const changes = [];

    // Helper to detect, format, and push modifications to the changes array
    const checkChange = (key, friendlyName, formatValue = (v) => v) => {
      if (req.body[key] !== undefined) {
        // Special comparison for arrays (e.g., loanTenures)
        if (Array.isArray(settings[key])) {
          const oldArr = settings[key].join(", ");
          const newArr = req.body[key].join(", ");
          if (oldArr !== newArr) {
            changes.push(`${friendlyName} ([${oldArr}] -> [${newArr}])`);
            settings[key] = req.body[key];
          }
        }
        // Standard comparison for primitives
        else if (req.body[key] !== settings[key]) {
          changes.push(
            `${friendlyName} (${formatValue(settings[key])} -> ${formatValue(req.body[key])})`,
          );
          settings[key] = req.body[key];
        }
      }
    };

    // Track all potential field changes
    checkChange("interestRate", "Interest Rate", (v) => `${v}%`);
    checkChange("creditMultiplier", "Credit Multiplier", (v) => `${v}x`);
    checkChange("maintenanceMode", "Maintenance Mode");
    checkChange("allowRegistrations", "Open Enrollment");
    checkChange("loanFormFee", "Loan Form Fee", (v) => `₦${v / 100}`);
    checkChange("loanTenures", "Loan Tenures");

    // Only save and log if modifications actually occurred
    if (changes.length > 0) {
      await settings.save();

      // 🚀 FIX: Instantly wipe the auth middleware cache so changes (like Maintenance Mode) apply instantly
      clearSettingsCache();

      const detailedDescription = `Modified configurations: ${changes.join(", ")}.`;

      logAdminAction(
        req.user.id || req.user._id,
        "UPDATED_SETTINGS",
        detailedDescription,
      );
    }

    res
      .status(200)
      .json({ message: "Settings updated successfully", settings });
  } catch (error) {
    console.error("Settings Update Error:", error);
    res.status(500).json({ message: "Server error updating settings" });
  }
});

export default router;
