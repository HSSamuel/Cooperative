import express from "express";
import Account from "../models/Account.js";
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

// @route   GET /api/account/my-account
router.get("/my-account", protect, async (req, res) => {
  try {
    // Reverted to req.user.id to match your middleware
    const userId = req.user.id || req.user._id;

    let account = await Account.findOne({ cooperatorId: userId });
    
    if (!account) {
      account = await Account.create({
        cooperatorId: userId,
        totalSavings: 0,
        availableCreditLimit: 0
      });
    }

    res.status(200).json(account);
  } catch (error) {
    console.error("Fetch Account Error:", error);
    res.status(500).json({ message: "Server error fetching account data" });
  }
});

// @route   POST /api/account/deposit
router.post("/deposit", protect, async (req, res) => {
  try {
    const { amountInKobo } = req.body;

    if (!amountInKobo || amountInKobo <= 0 || !Number.isInteger(amountInKobo)) {
      return res.status(400).json({ message: "Invalid deposit amount. Must be a positive integer in Kobo." });
    }

    const userId = req.user.id || req.user._id;
    const account = await Account.findOne({ cooperatorId: userId });
    
    if (!account) {
      return res.status(404).json({ message: "Account not found" });
    }

    account.totalSavings += amountInKobo;
    account.availableCreditLimit = account.totalSavings * 2;
    await account.save();

    res.status(200).json({ message: "Deposit successful", account });
  } catch (error) {
    console.error("Deposit Error:", error);
    res.status(500).json({ message: "Server error processing deposit" });
  }
});

// @route   GET /api/account/user/:cooperatorId
// @desc    Get a specific user's financial account data (Admin Only)
// @access  Private/Admin
router.get("/user/:cooperatorId", protect, admin, async (req, res) => {
  try {
    const account = await Account.findOne({
      cooperatorId: req.params.cooperatorId,
    });
    if (!account)
      return res
        .status(404)
        .json({ message: "Account not found for this user." });

    res.status(200).json(account);
  } catch (error) {
    console.error("Fetch Admin Account Error:", error);
    res.status(500).json({ message: "Server error fetching account data" });
  }
});

// @route   POST /api/account/admin-adjust
// @desc    Manually Credit or Debit an account (Admin Only)
// @access  Private/Admin
router.post("/admin-adjust", protect, admin, async (req, res) => {
  try {
    const { cooperatorId, amountInKobo, type } = req.body;

    if (!amountInKobo || amountInKobo <= 0) {
      return res
        .status(400)
        .json({ message: "Amount must be greater than zero." });
    }

    const account = await Account.findOne({ cooperatorId });
    if (!account)
      return res.status(404).json({ message: "Account not found." });

    if (type === "CREDIT") {
      account.totalSavings += amountInKobo;
    } else if (type === "DEBIT") {
      if (account.totalSavings < amountInKobo) {
        return res
          .status(400)
          .json({
            message: "Cannot debit more than the available total savings.",
          });
      }
      account.totalSavings -= amountInKobo;
    } else {
      return res.status(400).json({ message: "Invalid adjustment type." });
    }

    account.availableCreditLimit = account.totalSavings * 2;
    await account.save();

    res.status(200).json({
      message: `Successfully ${type === "CREDIT" ? "credited" : "debited"} account.`,
      account,
    });
  } catch (error) {
    console.error("Admin Adjust Error:", error);
    res.status(500).json({ message: "Server error processing adjustment." });
  }
});

export default router;
