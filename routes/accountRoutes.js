import express from "express";
import Account from "../models/Account.js";
import Loan from "../models/Loan.js";
import Notification from "../models/Notification.js";
import Transaction from "../models/Transaction.js"; // 🚀 INTEGRATED TRANSACTION LEDGER
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

// Helper to get current Month/Year string (e.g., "October 2023")
const getCurrentMonthString = () => {
  return new Date().toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
  });
};

// @route   GET /api/account/my-account
// @desc    Get the logged-in user's financial account data
// @access  Private (Requires Token)
router.get("/my-account", protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

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
    ).populate(
      "cooperatorId",
      "firstName lastName email fileNumber dateJoined createdAt",
    );

    res.status(200).json(account);
  } catch (error) {
    console.error("Fetch Account Error:", error);
    res.status(500).json({ message: "Server error fetching account data" });
  }
});

// @route   GET /api/account/transactions
// @desc    Get the logged-in user's transaction ledger
// @access  Private
router.get("/transactions", protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const transactions = await Transaction.find({ cooperatorId: userId }).sort({
      createdAt: -1,
    });
    res.status(200).json(transactions);
  } catch (error) {
    console.error("Fetch Transactions Error:", error);
    res.status(500).json({ message: "Server error fetching transactions" });
  }
});

// @route   POST /api/account/deposit
router.post("/deposit", protect, async (req, res) => {
  try {
    const { amountInKobo } = req.body;

    if (!amountInKobo || amountInKobo <= 0 || !Number.isInteger(amountInKobo)) {
      return res.status(400).json({
        message: "Invalid deposit amount. Must be a positive integer in Kobo.",
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

    // 🚀 LOG THE TRANSACTION
    await Transaction.create({
      cooperatorId: userId,
      type: "CREDIT",
      amount: amountInKobo,
      description: "Self-Initiated Deposit",
      effectiveMonth: getCurrentMonthString(),
      balanceAfter: account.totalSavings,
    });

    // Notify the user of their deposit
    await Notification.create({
      user: userId,
      title: "Deposit Successful",
      message: `Your deposit of ₦${(amountInKobo / 100).toLocaleString()} has been added to your savings.`,
      type: "financial",
    });

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");
    if (io && onlineUsers) {
      const targetSocket = onlineUsers.get(userId.toString());
      if (targetSocket) io.to(targetSocket).emit("update_notifications");
    }

    res.status(200).json({ message: "Deposit successful", account });
  } catch (error) {
    console.error("Deposit Error:", error);
    res.status(500).json({ message: "Server error processing deposit" });
  }
});

// @route   GET /api/account/user/:cooperatorId
router.get("/user/:cooperatorId", protect, admin, async (req, res) => {
  try {
    const account = await Account.findOne({
      cooperatorId: req.params.cooperatorId,
    }).populate("cooperatorId");

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

    // 🚀 LOG THE TRANSACTION
    await Transaction.create({
      cooperatorId: cooperatorId,
      type: type,
      amount: amountInKobo,
      description: `Manual Ledger Adjustment (${type})`,
      effectiveMonth: getCurrentMonthString(),
      balanceAfter: account.totalSavings,
    });

    await Notification.create({
      user: cooperatorId,
      title: "Admin Account Adjustment",
      message: `Your account was manually ${type === "CREDIT" ? "credited" : "debited"} by ₦${(amountInKobo / 100).toLocaleString()}.`,
      type: "financial",
    });

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");
    if (io && onlineUsers) {
      const targetSocket = onlineUsers.get(cooperatorId.toString());
      if (targetSocket) io.to(targetSocket).emit("update_notifications");
    }

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
// @desc    Run automated monthly payroll deductions for Savings and Loans
// @access  Private/Admin
router.post("/run-reconciliation", protect, admin, async (req, res) => {
  try {
    const { standardSavingsKobo } = req.body;

    if (!standardSavingsKobo || standardSavingsKobo <= 0) {
      return res.status(400).json({
        message: "Must provide a valid standard savings amount in Kobo.",
      });
    }

    const notificationsToInsert = [];
    const transactionsToInsert = []; // 🚀 BULK TRANSACTION ARRAY

    // 1. UPDATE SAVINGS (ONLY FOR ACTIVE ACCOUNTS)
    const accounts = await Account.find({ status: "ACTIVE" });
    const currentMonth = getCurrentMonthString();

    for (let account of accounts) {
      const amountToSave =
        account.customMonthlySavings > 0
          ? account.customMonthlySavings
          : standardSavingsKobo;

      account.totalSavings += amountToSave;
      account.availableCreditLimit = account.totalSavings * 2;

      await account.save();

      // Queue Savings Transaction (CREDIT)
      transactionsToInsert.push({
        cooperatorId: account.cooperatorId,
        type: "CREDIT",
        amount: amountToSave,
        description: `Automated Payroll Savings - ${currentMonth}`,
        effectiveMonth: currentMonth,
        balanceAfter: account.totalSavings,
      });

      // Queue Savings Notification
      notificationsToInsert.push({
        user: account.cooperatorId,
        title: "Monthly Savings Deducted",
        message: `Your monthly savings of ₦${(amountToSave / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })} has been successfully processed.`,
        type: "financial",
      });
    }

    // 2. DEDUCT ALL ACTIVE LOAN INSTALLMENTS
    const activeLoans = await Loan.find({ status: "APPROVED" }).populate("cooperatorId");
    let loansProcessed = 0;

    for (let loan of activeLoans) {
      const userAccount = await Account.findOne({ cooperatorId: loan.cooperatorId._id });
      if (userAccount && userAccount.status !== "ACTIVE") {
        continue; // Skip deductions for inactive/suspended members
      }

      const targetRepayment = loan.amountDue || loan.amountRequested;
      const monthlyInstallment = Math.round(targetRepayment * 0.1); // Assuming 10% monthly

      loan.amountRepaid += monthlyInstallment;
      let isFullyRepaid = false;

      if (loan.amountRepaid >= targetRepayment) {
        loan.amountRepaid = targetRepayment;
        loan.status = "REPAID";
        isFullyRepaid = true;
      }

      await loan.save();
      loansProcessed++;

      // 🚀 TRANSPARENT LOAN DEBIT LOGGING
      // Calculates exactly what the user owes after this deduction
      const remainingBalance = targetRepayment - loan.amountRepaid;

      // Queue Loan Transaction (DEBIT)
      transactionsToInsert.push({
        cooperatorId: loan.cooperatorId._id,
        type: "DEBIT",
        amount: monthlyInstallment,
        description: `Automated Deduction: ${loan.loanType || 'Loan'} Repayment. Remaining Balance: ₦${(remainingBalance / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`,
        effectiveMonth: currentMonth,
        balanceAfter: userAccount.totalSavings, 
      });

      // Queue Loan Notification
      notificationsToInsert.push({
        user: loan.cooperatorId._id,
        title: "Loan Installment Processed",
        message: `Your monthly loan deduction of ₦${(monthlyInstallment / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })} was processed.${isFullyRepaid ? " Your loan is now fully repaid!" : ""}`,
        type: "financial",
      });
    }

    // 3. EXECUTE BULK INSERTS TO MONGODB
    if (transactionsToInsert.length > 0) {
      await Transaction.insertMany(transactionsToInsert);
    }
    
    if (notificationsToInsert.length > 0) {
      await Notification.insertMany(notificationsToInsert);
      
      // Emit live WebSocket events to all affected users currently online
      const io = req.app.get("io");
      const onlineUsers = req.app.get("onlineUsers");
      if (io && onlineUsers) {
        notificationsToInsert.forEach(notif => {
          const targetSocket = onlineUsers.get(notif.user.toString());
          if (targetSocket) io.to(targetSocket).emit("update_notifications");
        });
      }
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
router.put("/user/:cooperatorId/settings", protect, admin, async (req, res) => {
  try {
    const { status, customMonthlySavings } = req.body;

    const account = await Account.findOne({
      cooperatorId: req.params.cooperatorId,
    });
    if (!account)
      return res.status(404).json({ message: "Account not found." });

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
    res
      .status(500)
      .json({ message: "Server error updating account settings." });
  }
});

// @route   GET /api/account/all-accounts
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
    res.status(500).json({ message: "Server error fetching global stats." });
  }
});

export default router;
