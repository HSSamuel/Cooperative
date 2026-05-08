import express from "express";
import Account from "../models/Account.js";
import Loan from "../models/Loan.js";
import Notification from "../models/Notification.js";
import Transaction from "../models/Transaction.js";
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

const getCurrentMonthString = () => {
  return new Date().toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
  });
};

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

router.get("/transactions", protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    // 🚀 LIMIT query variable added to prevent payload bloat (Redux over-fetching)
    const limit = parseInt(req.query.limit) || 0;

    let query = Transaction.find({ cooperatorId: userId }).sort({
      createdAt: -1,
    });
    if (limit > 0) query = query.limit(limit);

    const transactions = await query;
    res.status(200).json(transactions);
  } catch (error) {
    console.error("Fetch Transactions Error:", error);
    res.status(500).json({ message: "Server error fetching transactions" });
  }
});

router.post("/deposit", protect, async (req, res) => {
  try {
    const { amountInKobo, targetUserId } = req.body;

    if (!amountInKobo || amountInKobo <= 0 || !Number.isInteger(amountInKobo)) {
      return res.status(400).json({
        message: "Invalid deposit amount. Must be a positive integer in Kobo.",
      });
    }
    if (!targetUserId) {
      return res
        .status(400)
        .json({ message: "Must specify the target Cooperator ID." });
    }

    const account = await Account.findOneAndUpdate(
      { cooperatorId: targetUserId },
      {
        $inc: {
          totalSavings: amountInKobo,
          availableCreditLimit: amountInKobo * 2,
        },
      },
      { returnDocument: "after" },
    );

    if (!account) return res.status(404).json({ message: "Account not found" });

    await Transaction.create({
      cooperatorId: targetUserId,
      type: "CREDIT",
      amount: amountInKobo,
      description: "Manual Deposit Logged by Admin",
      effectiveMonth: getCurrentMonthString(),
      balanceAfter: account.totalSavings,
    });

    await Notification.create({
      user: targetUserId,
      title: "Deposit Successful",
      message: `A deposit of ₦${(amountInKobo / 100).toLocaleString()} has been verified and added to your savings.`,
      type: "financial",
    });

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");
    if (io && onlineUsers) {
      const targetSocket = onlineUsers.get(targetUserId.toString());
      if (targetSocket) io.to(targetSocket).emit("update_notifications");
    }

    res.status(200).json({ message: "Deposit logged successfully", account });
  } catch (error) {
    console.error("Deposit Error:", error);
    res.status(500).json({ message: "Server error processing deposit" });
  }
});

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

router.post("/admin-adjust", protect, admin, async (req, res) => {
  try {
    const { cooperatorId, amountInKobo, type } = req.body;

    if (!amountInKobo || amountInKobo <= 0) {
      return res
        .status(400)
        .json({ message: "Amount must be greater than zero." });
    }

    let account;

    if (type === "CREDIT") {
      account = await Account.findOneAndUpdate(
        { cooperatorId },
        {
          $inc: {
            totalSavings: amountInKobo,
            availableCreditLimit: amountInKobo * 2,
          },
        },
        { returnDocument: "after" },
      );
    } else if (type === "DEBIT") {
      account = await Account.findOneAndUpdate(
        {
          cooperatorId,
          totalSavings: { $gte: amountInKobo },
        },
        {
          $inc: {
            totalSavings: -amountInKobo,
            availableCreditLimit: -(amountInKobo * 2),
          },
        },
        { returnDocument: "after" },
      );

      if (!account) {
        return res.status(400).json({
          message: "Cannot debit more than the available total savings.",
        });
      }
    } else {
      return res.status(400).json({ message: "Invalid adjustment type." });
    }

    if (!account)
      return res.status(404).json({ message: "Account not found." });

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

router.post("/run-reconciliation", protect, admin, async (req, res) => {
  try {
    const { standardSavingsKobo } = req.body;

    if (!standardSavingsKobo || standardSavingsKobo <= 0) {
      return res.status(400).json({
        message: "Must provide a valid standard savings amount in Kobo.",
      });
    }

    const currentMonth = getCurrentMonthString();
    const BATCH_SIZE = 500;

    let accountsProcessed = 0;
    let loansProcessedCount = 0;

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    let accountBulkOps = [];
    let savingsTransactions = [];
    let savingsNotifications = [];

    const accountCursor = Account.find({ status: "ACTIVE" }).cursor();

    for (
      let account = await accountCursor.next();
      account != null;
      account = await accountCursor.next()
    ) {
      const amountToSave =
        account.customMonthlySavings > 0
          ? account.customMonthlySavings
          : standardSavingsKobo;

      const newTotalSavings = account.totalSavings + amountToSave;
      const newCreditLimit = newTotalSavings * 2;

      accountBulkOps.push({
        updateOne: {
          filter: { _id: account._id },
          update: {
            totalSavings: newTotalSavings,
            availableCreditLimit: newCreditLimit,
          },
        },
      });

      savingsTransactions.push({
        cooperatorId: account.cooperatorId,
        type: "CREDIT",
        amount: amountToSave,
        description: `Automated Payroll Savings - ${currentMonth}`,
        effectiveMonth: currentMonth,
        balanceAfter: newTotalSavings,
      });

      savingsNotifications.push({
        user: account.cooperatorId,
        title: "Monthly Savings Deducted",
        message: `Your monthly savings of ₦${(amountToSave / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })} has been successfully processed.`,
        type: "financial",
      });

      accountsProcessed++;

      if (accountBulkOps.length >= BATCH_SIZE) {
        await Promise.all([
          Account.bulkWrite(accountBulkOps),
          Transaction.insertMany(savingsTransactions),
          Notification.insertMany(savingsNotifications),
        ]);

        if (io && onlineUsers) {
          savingsNotifications.forEach((notif) => {
            const targetSocket = onlineUsers.get(notif.user.toString());
            if (targetSocket) io.to(targetSocket).emit("update_notifications");
          });
        }

        accountBulkOps = [];
        savingsTransactions = [];
        savingsNotifications = [];
      }
    }

    if (accountBulkOps.length > 0) {
      await Promise.all([
        Account.bulkWrite(accountBulkOps),
        Transaction.insertMany(savingsTransactions),
        Notification.insertMany(savingsNotifications),
      ]);

      if (io && onlineUsers) {
        savingsNotifications.forEach((notif) => {
          const targetSocket = onlineUsers.get(notif.user.toString());
          if (targetSocket) io.to(targetSocket).emit("update_notifications");
        });
      }
    }

    let loanBulkOps = [];
    let loanTransactions = [];
    let loanNotifications = [];

    const loanCursor = Loan.find({ status: "APPROVED" })
      .populate("cooperatorId")
      .cursor();

    for (
      let loan = await loanCursor.next();
      loan != null;
      loan = await loanCursor.next()
    ) {
      const userAccount = await Account.findOne({
        cooperatorId: loan.cooperatorId._id,
      });
      if (userAccount && userAccount.status !== "ACTIVE") {
        continue;
      }

      const targetRepayment = loan.amountDue || loan.amountRequested;
      // 🚀 THE FIX: Calculate automated monthly deduction using the actual tenure
      const loanTenure = loan.tenure || 10;
      const monthlyInstallment = Math.round(targetRepayment / loanTenure);

      let newAmountRepaid = loan.amountRepaid + monthlyInstallment;
      let newStatus = "APPROVED";
      let isFullyRepaid = false;

      if (newAmountRepaid >= targetRepayment) {
        newAmountRepaid = targetRepayment;
        newStatus = "REPAID";
        isFullyRepaid = true;
      }

      loansProcessedCount++;
      const remainingBalance = targetRepayment - newAmountRepaid;

      loanBulkOps.push({
        updateOne: {
          filter: { _id: loan._id },
          update: {
            amountRepaid: newAmountRepaid,
            status: newStatus,
          },
        },
      });

      loanTransactions.push({
        cooperatorId: loan.cooperatorId._id,
        type: "DEBIT",
        amount: monthlyInstallment,
        description: `Automated Deduction: ${loan.loanType || "Loan"} Repayment. Remaining Balance: ₦${(remainingBalance / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`,
        effectiveMonth: currentMonth,
        balanceAfter: userAccount ? userAccount.totalSavings : 0,
      });

      loanNotifications.push({
        user: loan.cooperatorId._id,
        title: "Loan Installment Processed",
        message: `Your monthly loan deduction of ₦${(monthlyInstallment / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })} was processed.${isFullyRepaid ? " Your loan is now fully repaid!" : ""}`,
        type: "financial",
      });

      if (loanBulkOps.length >= BATCH_SIZE) {
        await Promise.all([
          Loan.bulkWrite(loanBulkOps),
          Transaction.insertMany(loanTransactions),
          Notification.insertMany(loanNotifications),
        ]);

        if (io && onlineUsers) {
          loanNotifications.forEach((notif) => {
            const targetSocket = onlineUsers.get(notif.user.toString());
            if (targetSocket) io.to(targetSocket).emit("update_notifications");
          });
        }

        loanBulkOps = [];
        loanTransactions = [];
        loanNotifications = [];
      }
    }

    if (loanBulkOps.length > 0) {
      await Promise.all([
        Loan.bulkWrite(loanBulkOps),
        Transaction.insertMany(loanTransactions),
        Notification.insertMany(loanNotifications),
      ]);

      if (io && onlineUsers) {
        loanNotifications.forEach((notif) => {
          const targetSocket = onlineUsers.get(notif.user.toString());
          if (targetSocket) io.to(targetSocket).emit("update_notifications");
        });
      }
    }

    res.status(200).json({
      message: "Monthly Reconciliation Complete!",
      stats: {
        savingsAccountsUpdated: accountsProcessed,
        loansProcessed: loansProcessedCount,
      },
    });
  } catch (error) {
    console.error("Reconciliation Error:", error);
    res.status(500).json({ message: "Server error during reconciliation." });
  }
});

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
