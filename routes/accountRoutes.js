import express from "express";
import Account from "../models/Account.js";
import Loan from "../models/Loan.js"; // 🚀 FIXED: Added missing Loan import for reconciliation
import Notification from "../models/Notification.js"; // 🚀 NEW: Added Notification engine
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

// @route   GET /api/account/my-account
// @desc    Get the logged-in user's financial account data
// @access  Private (Requires Token)
router.get("/my-account", protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    // The Atomic Upsert prevents React double-firing bugs
    const account = await Account.findOneAndUpdate(
      { cooperatorId: userId },
      {
        $setOnInsert: {
          totalSavings: 0,
          availableCreditLimit: 0,
        },
      },
      {
        returnDocument: "after",
        upsert: true,
        setDefaultsOnInsert: true,
      },
    );

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
      return res
        .status(400)
        .json({
          message:
            "Invalid deposit amount. Must be a positive integer in Kobo.",
        });
    }

    const userId = req.user.id || req.user._id;
    const account = await Account.findOne({ cooperatorId: userId });

    if (!account) {
      return res.status(404).json({ message: "Account not found" });
    }

    account.totalSavings += amountInKobo;
    account.availableCreditLimit = account.totalSavings * 2;
    await account.save();

    // 🚀 NEW: Notify the user of their deposit
    await Notification.create({
      user: userId,
      title: "Deposit Successful",
      message: `Your deposit of ₦${(amountInKobo / 100).toLocaleString()} has been added to your savings.`,
      type: "financial",
    });

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
        return res.status(400).json({
          message: "Cannot debit more than the available total savings.",
        });
      }
      account.totalSavings -= amountInKobo;
    } else {
      return res.status(400).json({ message: "Invalid adjustment type." });
    }

    account.availableCreditLimit = account.totalSavings * 2;
    await account.save();

    // 🚀 NEW: Notify the user that an Admin adjusted their account
    await Notification.create({
      user: cooperatorId,
      title: "Admin Account Adjustment",
      message: `Your account was manually ${type === "CREDIT" ? "credited" : "debited"} by ₦${(amountInKobo / 100).toLocaleString()}.`,
      type: "financial",
    });

    res.status(200).json({
      message: `Successfully ${type === "CREDIT" ? "credited" : "debited"} account.`,
      account,
    });
  } catch (error) {
    console.error("Admin Adjust Error:", error);
    res.status(500).json({ message: "Server error processing adjustment." });
  }
});

// @route   POST /api/account/run-reconciliation
// @desc    Admin triggers monthly ledger updates after payroll clears
// @access  Private/Admin
router.post("/run-reconciliation", protect, admin, async (req, res) => {
  try {
    const { standardSavingsKobo } = req.body;

    if (!standardSavingsKobo || standardSavingsKobo <= 0) {
      return res
        .status(400)
        .json({
          message: "Must provide a valid standard savings amount in Kobo.",
        });
    }

    // Array to hold all mass-notifications so we can insert them into the DB at once (highly efficient)
    const notificationsToInsert = [];

    // 1. UPDATE SAVINGS (ONLY FOR ACTIVE ACCOUNTS)
    const accounts = await Account.find({ status: "ACTIVE" });

    for (let account of accounts) {
      const amountToSave =
        account.customMonthlySavings > 0
          ? account.customMonthlySavings
          : standardSavingsKobo;

      account.totalSavings += amountToSave;
      account.availableCreditLimit = account.totalSavings * 2;

      await account.save();

      // Queue the savings notification
      notificationsToInsert.push({
        user: account.cooperatorId,
        title: "Monthly Savings Deducted",
        message: `Your monthly savings of ₦${(amountToSave / 100).toLocaleString()} has been successfully processed.`,
        type: "financial",
      });
    }

    // 2. DEDUCT ALL ACTIVE LOAN INSTALLMENTS
    const activeLoans = await Loan.find({ status: "APPROVED" }).populate(
      "cooperatorId",
    );

    let loansProcessed = 0;

    for (let loan of activeLoans) {
      const userAccount = await Account.findOne({
        cooperatorId: loan.cooperatorId._id,
      });
      if (userAccount && userAccount.status !== "ACTIVE") {
        continue; // Skip to the next loan if the user is paused
      }

      const targetRepayment = loan.amountDue || loan.amountRequested;
      const monthlyInstallment = Math.round(targetRepayment * 0.1); // 10% monthly deduction

      loan.amountRepaid += monthlyInstallment;

      if (loan.amountRepaid >= targetRepayment) {
        loan.amountRepaid = targetRepayment;
        loan.status = "REPAID";
      }

      await loan.save();
      loansProcessed++;

      // Queue the loan deduction notification
      notificationsToInsert.push({
        user: loan.cooperatorId._id,
        title: "Loan Installment Processed",
        message: `Your monthly loan deduction of ₦${(monthlyInstallment / 100).toLocaleString()} was processed.${loan.status === "REPAID" ? " Your loan is now fully repaid!" : ""}`,
        type: "financial",
      });
    }

    // 🚀 NEW: Bulk insert all generated notifications to the database instantly
    if (notificationsToInsert.length > 0) {
      await Notification.insertMany(notificationsToInsert);
    }

    res.status(200).json({
      message: "Monthly Reconciliation Complete!",
      stats: {
        savingsAccountsUpdated: accounts.length,
        loansProcessed: loansProcessed,
      },
    });
  } catch (error) {
    console.error("Reconciliation Error:", error);
    res.status(500).json({ message: "Server error during reconciliation." });
  }
});

// @route   PUT /api/account/user/:cooperatorId/settings
// @desc    Update a user's account status and custom savings (Admin Only)
// @access  Private/Admin
router.put("/user/:cooperatorId/settings", protect, admin, async (req, res) => {
  try {
    const { status, customMonthlySavings } = req.body;

    const account = await Account.findOne({
      cooperatorId: req.params.cooperatorId,
    });
    if (!account)
      return res
        .status(404)
        .json({ message: "Account not found for this user." });

    let messageStr = "An Admin has updated your account settings. ";

    if (status) {
      account.status = status;
      messageStr += `Your status is now ${status}. `;
    }

    if (customMonthlySavings !== undefined) {
      account.customMonthlySavings = customMonthlySavings;
      messageStr += `Your custom monthly savings has been set to ₦${(customMonthlySavings / 100).toLocaleString()}.`;
    }

    await account.save();

    // 🚀 NEW: Notify the user of settings change
    await Notification.create({
      user: req.params.cooperatorId,
      title: "Account Settings Updated",
      message: messageStr.trim(),
      type: "system",
    });

    res.status(200).json({
      message: "Member account settings updated successfully.",
      account,
    });
  } catch (error) {
    console.error("Account Settings Update Error:", error);
    res
      .status(500)
      .json({ message: "Server error updating account settings." });
  }
});

// @route   GET /api/account/all-accounts
// @desc    Get all accounts with user details for the Admin table
// @access  Private/Admin
router.get("/all-accounts", protect, admin, async (req, res) => {
  try {
    const accounts = await Account.find({}).populate(
      "cooperatorId",
      "firstName lastName fileNumber email",
    );
    res.status(200).json(accounts);
  } catch (error) {
    res.status(500).json({ message: "Server error fetching accounts." });
  }
});

// @route   GET /api/account/global-stats
// @desc    Get total cooperative savings and member count for Admin Dashboard
// @access  Private/Admin
router.get("/global-stats", protect, admin, async (req, res) => {
  try {
    const accounts = await Account.find({});
    const totalSavings = accounts.reduce(
      (acc, curr) => acc + curr.totalSavings,
      0,
    );
    const activeMembersCount = accounts.filter(
      (acc) => acc.status === "ACTIVE",
    ).length;

    res.status(200).json({
      totalCooperativeSavings: totalSavings,
      activeMembersCount: activeMembersCount,
    });
  } catch (error) {
    console.error("Global Stats Error:", error);
    res.status(500).json({ message: "Server error fetching global stats." });
  }
});

export default router;
