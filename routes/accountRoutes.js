import express from "express";
import mongoose from "mongoose";
import Account from "../models/Account.js";
import Loan from "../models/Loan.js";
import Notification from "../models/Notification.js";
import Transaction from "../models/Transaction.js";
import Cooperator from "../models/Cooperator.js";
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
    const { amountInKobo, targetUserId, description } = req.body;

    const callerId = req.user.id || req.user._id;
    const callerRole = req.user.role;

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

    let finalDescription = "Direct Savings Deposit";

    if (description && description.trim() !== "") {
      finalDescription = description.trim();
    } else if (callerId.toString() === targetUserId.toString()) {
      finalDescription = "Self-Initiated Savings Deposit";
    } else if (callerRole === "ADMIN" || callerRole === "SUPER_ADMIN") {
      finalDescription = "Deposit Logged by Admin";
    }

    await Transaction.create({
      cooperatorId: targetUserId,
      type: "CREDIT",
      amount: amountInKobo,
      description: finalDescription,
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

    const currentMonthString = getCurrentMonthString();
    const monthlyDeposits = await Transaction.find({
      cooperatorId: req.params.cooperatorId,
      type: "CREDIT",
      effectiveMonth: currentMonthString,
    });

    const currentMonthSavings = monthlyDeposits.reduce(
      (sum, txn) => sum + txn.amount,
      0,
    );

    res.status(200).json({
      ...account.toObject(),
      currentMonthSavings,
    });
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
    } else if (type === "DIVIDEND") {
      // 🚀 NEW: Handle Individual Dividend Distribution
      account = await Account.findOneAndUpdate(
        { cooperatorId },
        {
          $inc: {
            totalDividends: amountInKobo, // Track lifetime dividends
            totalSavings: amountInKobo, // Add cash to main savings
            availableCreditLimit: amountInKobo * 2, // Increase credit limit
          },
        },
        { returnDocument: "after" },
      );
    } else {
      return res.status(400).json({ message: "Invalid adjustment type." });
    }

    if (!account)
      return res.status(404).json({ message: "Account not found." });

    // 🚀 Update Transaction Description
    await Transaction.create({
      cooperatorId: cooperatorId,
      type: type === "DEBIT" ? "DEBIT" : "CREDIT",
      amount: amountInKobo,
      description:
        type === "DIVIDEND"
          ? "Dividend Payout"
          : `Manual Ledger Adjustment (${type})`,
      effectiveMonth: getCurrentMonthString(),
      balanceAfter: account.totalSavings,
    });

    // 🚀 Update Notification Message
    let notifTitle = "Admin Account Adjustment";
    let notifMessage = `Your account was manually ${type === "CREDIT" ? "credited" : "debited"} by ₦${(amountInKobo / 100).toLocaleString()}.`;

    if (type === "DIVIDEND") {
      notifTitle = "Dividend Received";
      notifMessage = `Your account was credited with a cooperative dividend of ₦${(amountInKobo / 100).toLocaleString()}.`;
    }

    await Notification.create({
      user: cooperatorId,
      title: notifTitle,
      message: notifMessage,
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

    res.status(202).json({
      message:
        "Monthly Reconciliation engine initiated. You will be notified upon completion.",
    });

    (async () => {
      const session = await mongoose.startSession();
      try {
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
            session.startTransaction();
            try {
              await Promise.all([
                Account.bulkWrite(accountBulkOps, { session }),
                Transaction.insertMany(savingsTransactions, { session }),
                Notification.insertMany(savingsNotifications, { session }),
              ]);
              await session.commitTransaction();
            } catch (batchError) {
              await session.abortTransaction();
              console.error("Batch savings transaction failed...", batchError);
            }

            if (io && onlineUsers) {
              savingsNotifications.forEach((notif) => {
                const targetSocket = onlineUsers.get(notif.user.toString());
                if (targetSocket)
                  io.to(targetSocket).emit("update_notifications");
              });
            }

            accountBulkOps = [];
            savingsTransactions = [];
            savingsNotifications = [];
          }
        }

        if (accountBulkOps.length > 0) {
          session.startTransaction();
          try {
            await Promise.all([
              Account.bulkWrite(accountBulkOps, { session }),
              Transaction.insertMany(savingsTransactions, { session }),
              Notification.insertMany(savingsNotifications, { session }),
            ]);
            await session.commitTransaction();
          } catch (batchError) {
            await session.abortTransaction();
            console.error("Trailing savings transaction failed...", batchError);
          }

          if (io && onlineUsers) {
            savingsNotifications.forEach((notif) => {
              const targetSocket = onlineUsers.get(notif.user.toString());
              if (targetSocket)
                io.to(targetSocket).emit("update_notifications");
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
            session.startTransaction();
            try {
              await Promise.all([
                Loan.bulkWrite(loanBulkOps, { session }),
                Transaction.insertMany(loanTransactions, { session }),
                Notification.insertMany(loanNotifications, { session }),
              ]);
              await session.commitTransaction();
            } catch (batchError) {
              await session.abortTransaction();
              console.error("Batch loan transaction failed...", batchError);
            }

            if (io && onlineUsers) {
              loanNotifications.forEach((notif) => {
                const targetSocket = onlineUsers.get(notif.user.toString());
                if (targetSocket)
                  io.to(targetSocket).emit("update_notifications");
              });
            }

            loanBulkOps = [];
            loanTransactions = [];
            loanNotifications = [];
          }
        }

        if (loanBulkOps.length > 0) {
          session.startTransaction();
          try {
            await Promise.all([
              Loan.bulkWrite(loanBulkOps, { session }),
              Transaction.insertMany(loanTransactions, { session }),
              Notification.insertMany(loanNotifications, { session }),
            ]);
            await session.commitTransaction();
          } catch (batchError) {
            await session.abortTransaction();
            console.error("Trailing loan transaction failed...", batchError);
          }

          if (io && onlineUsers) {
            loanNotifications.forEach((notif) => {
              const targetSocket = onlineUsers.get(notif.user.toString());
              if (targetSocket)
                io.to(targetSocket).emit("update_notifications");
            });
          }
        }

        const adminId = req.user.id || req.user._id;
        await Notification.create({
          user: adminId,
          title: "Reconciliation Complete",
          message: `Monthly reconciliation successfully processed ${accountsProcessed} savings accounts and ${loansProcessedCount} active loans.`,
          type: "system",
        });

        if (io && onlineUsers) {
          const targetSocket = onlineUsers.get(adminId.toString());
          if (targetSocket) io.to(targetSocket).emit("update_notifications");
        }
      } catch (backgroundError) {
        console.error("Reconciliation Background Error:", backgroundError);
      } finally {
        session.endSession();
      }
    })();
  } catch (error) {
    console.error("Reconciliation Init Error:", error);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ message: "Server error initiating reconciliation." });
    }
  }
});

router.put(
  "/user/:cooperatorId/settings",
  protect,
  admin,
  async (req, res, next) => {
    try {
      const { status, customMonthlySavings, dateJoined } = req.body;

      const account = await Account.findOne({
        cooperatorId: req.params.cooperatorId,
      });

      if (!account) {
        return res.status(404).json({ message: "Account not found." });
      }

      let messageStr = "An Admin has updated your account settings. ";

      if (status) {
        account.status = status;
        messageStr += `Your status is now ${status}. `;
      }

      if (customMonthlySavings !== undefined) {
        account.customMonthlySavings = customMonthlySavings;
        messageStr += `Your custom monthly savings has been set to ₦${(customMonthlySavings / 100).toLocaleString()}. `;
      }

      await account.save();

      if (dateJoined) {
        const user = await Cooperator.findById(req.params.cooperatorId);
        if (user) {
          user.dateJoined = new Date(dateJoined);
          await user.save();
          messageStr += `Your official join date was updated to ${new Date(dateJoined).toLocaleDateString()}.`;
        }
      }

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
      next(error);
    }
  },
);

// Replace the existing /all-accounts route
router.get("/all-accounts", protect, admin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const accounts = await Account.find({})
      .populate("cooperatorId", "firstName lastName fileNumber email")
      .skip(skip)
      .limit(limit);

    const total = await Account.countDocuments();

    res.status(200).json({
      accounts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
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

// @route   POST /api/account/distribute-dividends
// @desc    Distribute profit pool proportionally based on total savings
// @access  Admin
router.post("/distribute-dividends", protect, admin, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { totalPoolInKobo } = req.body;

    if (!totalPoolInKobo || totalPoolInKobo <= 0) {
      throw new Error("Must provide a valid dividend pool amount in Kobo.");
    }

    // 1. Fetch all ACTIVE accounts to calculate the global baseline
    const activeAccounts = await Account.find({ status: "ACTIVE" }).session(session);
    const globalSavingsBase = activeAccounts.reduce((sum, acc) => sum + acc.totalSavings, 0);

    if (globalSavingsBase === 0) {
      throw new Error("No active savings found to distribute against.");
    }

    const currentMonthString = getCurrentMonthString();
    let bulkAccountOps = [];
    let transactions = [];
    let notifications = [];

    // 2. Proportionally distribute dividends
    for (const acc of activeAccounts) {
      if (acc.totalSavings > 0) {
        // Calculate proportional share
        const ownershipPercentage = acc.totalSavings / globalSavingsBase;
        const dividendShare = Math.floor(ownershipPercentage * totalPoolInKobo);

        if (dividendShare > 0) {
          const newTotalSavings = acc.totalSavings + dividendShare;
          
          bulkAccountOps.push({
            updateOne: {
              filter: { _id: acc._id },
              update: {
                totalSavings: newTotalSavings,
                availableCreditLimit: newTotalSavings * 2,
              },
            },
          });

          transactions.push({
            cooperatorId: acc.cooperatorId,
            type: "CREDIT",
            amount: dividendShare,
            description: `Annual Cooperative Dividend Distribution`,
            effectiveMonth: currentMonthString,
            balanceAfter: newTotalSavings,
          });

          notifications.push({
            user: acc.cooperatorId,
            title: "Dividend Payout Received!",
            message: `Your account was credited with ₦${(dividendShare / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })} as your share of the cooperative profits.`,
            type: "success",
          });
        }
      }
    }

    // 3. Execute massive atomic write
    if (bulkAccountOps.length > 0) {
      await Account.bulkWrite(bulkAccountOps, { session });
      await Transaction.insertMany(transactions, { session });
      await Notification.insertMany(notifications, { session });
    }

    await session.commitTransaction();
    session.endSession();

    // 4. Fire WebSockets
    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");
    if (io && onlineUsers) {
      notifications.forEach((notif) => {
        const targetSocket = onlineUsers.get(notif.user.toString());
        if (targetSocket) io.to(targetSocket).emit("update_notifications");
      });
    }

    res.status(200).json({
      message: `Successfully distributed ₦${(totalPoolInKobo / 100).toLocaleString()} across ${bulkAccountOps.length} active members.`,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Dividend Error:", error);
    res.status(500).json({ message: error.message || "Server error distributing dividends" });
  }
});

// @route   GET /api/account/user/:cooperatorId/transactions
// @desc    Admin fetches specific member's micro-ledger
// @access  Admin
router.get("/user/:cooperatorId/transactions", protect, admin, async (req, res) => {
  try {
    const transactions = await Transaction.find({ cooperatorId: req.params.cooperatorId })
      .sort({ createdAt: -1 });
    res.status(200).json(transactions);
  } catch (error) {
    console.error("Fetch Admin Ledger Error:", error);
    res.status(500).json({ message: "Server error fetching member transactions." });
  }
});

export default router;
