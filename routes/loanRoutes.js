import express from "express";
import mongoose from "mongoose";
import { z } from "zod";
import Loan from "../models/Loan.js";
import Account from "../models/Account.js";
import Cooperator from "../models/Cooperator.js";
import Transaction from "../models/Transaction.js";
import SystemSetting from "../models/SystemSetting.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import {
  sendGuarantorRequestEmail,
  sendLoanStatusEmail,
  sendAdminApprovalEmail,
} from "../utils/emailService.js";
import Notification from "../models/Notification.js";
import { logAdminAction } from "../utils/auditLogger.js";

const router = express.Router();

// 🚀 Schema for Loan Application Validation
const loanRequestSchema = z.object({
  body: z
    .object({
      amountInKobo: z
        .number()
        .int()
        .positive("Amount must be a positive integer"),
      guarantor1FileNumber: z.string().min(3, "Valid file number required"),
      guarantor2FileNumber: z.string().min(3, "Valid file number required"),
      loanType: z
        .enum(["REGULAR", "EMERGENCY", "COMMODITY", "EQUIPMENT"])
        .optional()
        .default("REGULAR"),
      tenure: z.number().int().min(1).max(36).optional().default(10),
    })
    .refine((data) => data.guarantor1FileNumber !== data.guarantor2FileNumber, {
      message: "You must provide two distinct guarantors.",
      path: ["guarantor2FileNumber"],
    }),
});

// 🚀 Schema for Loan Repayment Validation
const repaySchema = z.object({
  body: z.object({
    amountInKobo: z
      .number()
      .int()
      .positive("Repayment must be greater than zero"),
  }),
});

// @route   POST /api/loans/request
// @desc    Submit a new loan application with guarantors (Atomic Transaction)
// @access  Private
router.post(
  "/request",
  protect,
  validate(loanRequestSchema),
  async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const {
        amountInKobo,
        guarantor1FileNumber,
        guarantor2FileNumber,
        loanType,
        tenure,
      } = req.body;
      const userId = req.user.id || req.user._id;

      // Fetch user for name mapping
      const currentUser = await Cooperator.findById(userId).session(session);

      // 🚀 ATOMIC LOCK: Fetch account within the transaction
      const account = await Account.findOne({ cooperatorId: userId }).session(
        session,
      );

      if (!account) {
        throw new Error(
          "Financial profile missing. Please contact Admin to sync your account.",
        );
      }

      // 🚀 ENFORCE 6-MONTH PROBATION RULE
      // (Currently commented out for testing purposes. Uncomment when ready for production.)
      /*
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const joinDate = currentUser.dateJoined || currentUser.createdAt;
    
    if (new Date(joinDate) > sixMonthsAgo) {
      throw new Error("Probation Active: You must be a registered member for at least 6 months to unlock loan eligibility.");
    }
    */

      if (amountInKobo > account.availableCreditLimit) {
        throw new Error(
          `Request exceeds your available credit limit of ₦${(account.availableCreditLimit / 100).toLocaleString()}.`,
        );
      }

      // 🚀 ATOMIC LOCK: Ensure no existing pending loans
      const existingPending = await Loan.findOne({
        cooperatorId: userId,
        status: { $in: ["PENDING_GUARANTORS", "PENDING_ADMIN", "APPROVED"] },
      }).session(session);

      if (existingPending) {
        throw new Error("You already have an active or pending loan.");
      }

      const g1 = await Cooperator.findOne({
        fileNumber: guarantor1FileNumber,
      }).session(session);
      const g2 = await Cooperator.findOne({
        fileNumber: guarantor2FileNumber,
      }).session(session);

      if (!g1 || !g2) {
        throw new Error("One or both guarantor file numbers are invalid.");
      }

      if (
        g1._id.toString() === userId.toString() ||
        g2._id.toString() === userId.toString()
      ) {
        throw new Error("You cannot guarantee your own loan.");
      }

      // Fetch Dynamic Interest Rate
      let currentInterestRate = 10;
      try {
        const settings = await SystemSetting.findOne().session(session);
        if (settings && settings.interestRate !== undefined) {
          currentInterestRate = settings.interestRate;
        }
      } catch (err) {
        console.error(
          "Could not fetch SystemSettings, using default interest rate.",
        );
      }

      const totalInterestRate = currentInterestRate * (tenure / 10);
      const interestAmount = Math.round(
        amountInKobo * (totalInterestRate / 100),
      );
      const amountDue = amountInKobo + interestAmount;

      const newLoan = new Loan({
        cooperatorId: userId,
        loanType: loanType,
        amountRequested: amountInKobo,
        tenure: tenure,
        interestRate: currentInterestRate,
        amountDue: amountDue,
        guarantor1: { cooperatorId: g1._id },
        guarantor2: { cooperatorId: g2._id },
        status: "PENDING_GUARANTORS",
      });

      // Save within the transaction bounds
      await newLoan.save({ session });

      // Commit Transaction
      await session.commitTransaction();
      session.endSession();

      // 🚀 NON-BLOCKING: Execute Email & WebSockets outside the transaction
      Promise.all([
        sendGuarantorRequestEmail(
          g1.email,
          currentUser.firstName,
          amountInKobo,
          newLoan._id,
        ),
        sendGuarantorRequestEmail(
          g2.email,
          currentUser.firstName,
          amountInKobo,
          newLoan._id,
        ),
      ]).catch((emailError) => {
        console.error("Non-fatal: Email delivery failed.", emailError.message);
      });

      await Notification.create([
        {
          user: userId,
          title: "Loan Application Submitted",
          message: `Your ${loanType} loan request for ₦${(amountInKobo / 100).toLocaleString()} has been sent to your guarantors.`,
          type: "info",
        },
        {
          user: g1._id,
          title: "Guarantor Request",
          message: `${currentUser.firstName} requested you as a guarantor for a loan of ₦${(amountInKobo / 100).toLocaleString()}.`,
          type: "info",
        },
        {
          user: g2._id,
          title: "Guarantor Request",
          message: `${currentUser.firstName} requested you as a guarantor for a loan of ₦${(amountInKobo / 100).toLocaleString()}.`,
          type: "info",
        },
      ]);

      const io = req.app.get("io");
      const onlineUsers = req.app.get("onlineUsers");

      if (io && onlineUsers) {
        const applicantSocket = onlineUsers.get(userId.toString());
        const g1Socket = onlineUsers.get(g1._id.toString());
        const g2Socket = onlineUsers.get(g2._id.toString());
        const liveMessage = `${currentUser.firstName} just requested you as a loan guarantor.`;

        if (applicantSocket)
          io.to(applicantSocket).emit("update_notifications");
        if (g1Socket)
          io.to(g1Socket).emit("new_guarantor_request", {
            message: liveMessage,
          });
        if (g2Socket)
          io.to(g2Socket).emit("new_guarantor_request", {
            message: liveMessage,
          });
      }

      res.status(201).json({
        message: "Loan submitted. Waiting for guarantors to accept.",
        loan: newLoan,
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("Loan Request Error:", error);
      res
        .status(400)
        .json({
          message: error.message || "Server error processing loan request",
        });
    }
  },
);

// @route   GET /api/loans/my-loans
router.get("/my-loans", protect, async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const loans = await Loan.find({ cooperatorId: userId })
      .populate("guarantor1.cooperatorId", "firstName lastName fileNumber")
      .populate("guarantor2.cooperatorId", "firstName lastName fileNumber")
      .sort({ createdAt: -1 });

    res.status(200).json(loans);
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/loans/all
router.get("/all", protect, admin, async (req, res) => {
  try {
    const loans = await Loan.find({})
      .populate("cooperatorId", "firstName lastName fileNumber")
      .sort({ createdAt: -1 });

    res.status(200).json(loans);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Server error fetching cooperative loans" });
  }
});

// @route   PUT /api/loans/:id/review
router.put("/:id/review", protect, admin, async (req, res) => {
  try {
    const { status, adminComment } = req.body;

    if (!["APPROVED", "REJECTED", "REPAID"].includes(status)) {
      return res.status(400).json({ message: "Invalid status update" });
    }

    const loan = await Loan.findById(req.params.id).populate("cooperatorId");
    if (!loan)
      return res.status(404).json({ message: "Loan request not found" });

    loan.status = status;
    if (adminComment) loan.adminComment = adminComment;
    await loan.save();

    logAdminAction(
      req.user.id || req.user._id,
      status === "APPROVED" ? "APPROVED_LOAN" : "REJECTED_LOAN",
      `${status === "APPROVED" ? "Approved" : "Rejected"} a loan of ₦${(loan.amountRequested / 100).toLocaleString()} for ${loan.cooperatorId.fileNumber}`,
      loan._id,
    );

    if (loan.cooperatorId && loan.cooperatorId.email) {
      sendLoanStatusEmail(
        loan.cooperatorId.email,
        loan.cooperatorId.firstName,
        status,
        loan.amountRequested,
      ).catch((err) => console.error("Email failed on admin review", err));
    }

    await Notification.create({
      user: loan.cooperatorId._id,
      title: `Loan ${status === "APPROVED" ? "Approved" : "Rejected"}`,
      message: `Your loan application for ₦${(loan.amountRequested / 100).toLocaleString()} was ${status.toLowerCase()} by the Admin.`,
      type: status === "APPROVED" ? "success" : "danger",
    });

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");
    if (io && onlineUsers) {
      const targetSocket = onlineUsers.get(loan.cooperatorId._id.toString());
      if (targetSocket) io.to(targetSocket).emit("update_notifications");
    }

    res
      .status(200)
      .json({ message: `Loan successfully marked as ${status}`, loan });
  } catch (error) {
    res.status(500).json({ message: "Server error reviewing loan" });
  }
});

// @route   POST /api/loans/:id/repay
// @desc    Self-Initiated Loan Repayment (Atomic Transaction)
router.post("/:id/repay", protect, validate(repaySchema), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { amountInKobo } = req.body;
    const userId = req.user.id || req.user._id;

    // 🚀 ATOMIC LOCK: Find loan
    const loan = await Loan.findOne({
      _id: req.params.id,
      cooperatorId: userId,
    }).session(session);

    if (!loan) throw new Error("Loan not found");
    if (loan.status !== "APPROVED") {
      throw new Error("You can only make payments on APPROVED loans");
    }

    const targetRepayment = loan.amountDue || loan.amountRequested;
    const remainingBalance = targetRepayment - loan.amountRepaid;
    const actualRepayment = Math.min(amountInKobo, remainingBalance);

    // 🚀 ATOMIC LOCK: Deduct from savings safely
    const account = await Account.findOneAndUpdate(
      {
        cooperatorId: userId,
        totalSavings: { $gte: actualRepayment },
      },
      {
        $inc: {
          totalSavings: -actualRepayment,
          availableCreditLimit: -(actualRepayment * 2),
        },
      },
      { new: true, session },
    );

    if (!account) {
      throw new Error("Insufficient savings to process this repayment.");
    }

    // 🚀 ATOMIC LOCK: Update loan balance
    loan.amountRepaid += actualRepayment;
    if (loan.amountRepaid >= targetRepayment) {
      loan.status = "REPAID";
      loan.amountRepaid = targetRepayment;
    }
    await loan.save({ session });

    const currentMonthString = new Date().toLocaleString("en-GB", {
      month: "long",
      year: "numeric",
    });

    // 🚀 ATOMIC LOCK: Register transaction
    await Transaction.create(
      [
        {
          cooperatorId: userId,
          type: "DEBIT",
          amount: actualRepayment,
          description: `Self-Initiated Loan Repayment. Balance: ₦${((targetRepayment - loan.amountRepaid) / 100).toLocaleString()}`,
          effectiveMonth: currentMonthString,
          balanceAfter: account.totalSavings,
        },
      ],
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    // 🚀 NON-BLOCKING notifications
    await Notification.create({
      user: userId,
      title:
        loan.status === "REPAID" ? "Loan Fully Repaid" : "Payment Received",
      message: `Your repayment of ₦${(actualRepayment / 100).toLocaleString()} was processed successfully.${loan.status === "REPAID" ? " Your loan is now fully settled." : ""}`,
      type: "financial",
    });

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");
    if (io && onlineUsers) {
      const targetSocket = onlineUsers.get(userId.toString());
      if (targetSocket) io.to(targetSocket).emit("update_notifications");
    }

    res.status(200).json({
      message:
        loan.status === "REPAID" ? "Loan fully repaid!" : "Payment successful",
      loan: loan,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Repayment Error:", error);
    res
      .status(400)
      .json({ message: error.message || "Server error processing repayment" });
  }
});

// @route   GET /api/loans/guarantor-requests
router.get("/guarantor-requests", protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const requests = await Loan.find({
      $or: [
        { "guarantor1.cooperatorId": userId, "guarantor1.status": "PENDING" },
        { "guarantor2.cooperatorId": userId, "guarantor2.status": "PENDING" },
      ],
    }).populate("cooperatorId", "firstName lastName fileNumber");

    res.status(200).json(requests);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Server error fetching guarantor requests" });
  }
});

// @route   PUT /api/loans/:id/guarantee
router.put("/:id/guarantee", protect, async (req, res) => {
  try {
    const { action } = req.body;
    if (!["ACCEPTED", "DECLINED"].includes(action))
      return res.status(400).json({ message: "Invalid action" });

    const loan = await Loan.findById(req.params.id).populate(
      "cooperatorId",
      "firstName lastName",
    );
    if (!loan) return res.status(404).json({ message: "Loan not found" });

    const userId = req.user.id || req.user._id;
    const isG1 = loan.guarantor1.cooperatorId.toString() === userId.toString();
    const isG2 = loan.guarantor2.cooperatorId.toString() === userId.toString();

    if (!isG1 && !isG2)
      return res
        .status(403)
        .json({ message: "You are not a guarantor for this loan." });

    if (isG1) loan.guarantor1.status = action;
    if (isG2) loan.guarantor2.status = action;

    const actingGuarantor = await Cooperator.findById(userId);
    const guarantorName = actingGuarantor
      ? `${actingGuarantor.firstName} ${actingGuarantor.lastName}`
      : "A guarantor";

    if (
      loan.guarantor1.status === "ACCEPTED" &&
      loan.guarantor2.status === "ACCEPTED"
    ) {
      loan.status = "PENDING_ADMIN";
      const admins = await Cooperator.find({
        role: { $in: ["ADMIN", "SUPER_ADMIN"] },
      });

      admins.forEach((admin) => {
        sendAdminApprovalEmail(
          admin.email,
          `${loan.cooperatorId.firstName} ${loan.cooperatorId.lastName}`,
          loan.amountRequested,
          loan._id,
        ).catch((err) =>
          console.error("Non-fatal: Admin email failed", err.message),
        );
      });

      const adminNotifications = admins.map((admin) => ({
        user: admin._id,
        title: "Action Required: Loan Review",
        message: `${loan.cooperatorId.firstName} ${loan.cooperatorId.lastName} has a loan of ₦${(loan.amountRequested / 100).toLocaleString()} waiting for your approval.`,
        type: "system",
      }));
      await Notification.insertMany(adminNotifications);

      const io = req.app.get("io");
      const onlineUsers = req.app.get("onlineUsers");
      if (io && onlineUsers) {
        admins.forEach((admin) => {
          const adminSocket = onlineUsers.get(admin._id.toString());
          if (adminSocket) io.to(adminSocket).emit("update_notifications");
        });
      }
    } else if (action === "DECLINED") {
      loan.status = "REJECTED";
      loan.adminComment = `Rejected automatically: ${guarantorName} declined the risk.`;
    }

    await loan.save();

    await Notification.create({
      user: loan.cooperatorId._id,
      title: `Guarantor ${action === "ACCEPTED" ? "Accepted" : "Declined"}`,
      message: `${guarantorName} has ${action.toLowerCase()} your loan request.`,
      type: action === "ACCEPTED" ? "success" : "danger",
    });

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");
    if (io && onlineUsers) {
      const targetSocket = onlineUsers.get(loan.cooperatorId._id.toString());
      if (targetSocket) io.to(targetSocket).emit("update_notifications");
    }

    res
      .status(200)
      .json({
        message: `Successfully ${action.toLowerCase()} the request.`,
        loan,
      });
  } catch (error) {
    console.error("Guarantor Action Error:", error);
    res.status(500).json({ message: "Server error processing guarantee" });
  }
});

// @route   GET /api/loans/payroll-report
router.get("/payroll-report", protect, admin, async (req, res) => {
  try {
    const activeLoans = await Loan.find({ status: "APPROVED" }).populate(
      "cooperatorId",
      "firstName lastName fileNumber",
    );
    
    // 1. Generate a dynamic date for the report header
    const reportMonth = new Date().toLocaleString("en-GB", {
      month: "long",
      year: "numeric",
    });

    // 2. Create the Professional Text "Letterhead"
    let csv = "ASCON STAFF MULTI-PURPOSE CO-OPERATIVE SOCIETY LIMITED\n";
    csv += `Official Monthly Payroll Deduction Report - ${reportMonth}\n`;
    csv += "Generated by ASCON Coop Automated System\n";
    csv += "----------------------------------------------------------------------------------------\n\n";

    // 3. The Updated Column Headings
    csv += "Staff File Number,First Name,Last Name,Principal (NGN),Total Due with Interest (NGN),Amount Repaid So Far (NGN),Outstanding Balance to Deduct (NGN)\n";

    // 4. Inject the Data
    activeLoans.forEach((loan) => {
      if (!loan.cooperatorId) return;
      const targetRepayment = loan.amountDue || loan.amountRequested;
      const balance = targetRepayment - loan.amountRepaid;
      
      csv += `"${loan.cooperatorId.fileNumber}","${loan.cooperatorId.firstName}","${loan.cooperatorId.lastName}","${loan.amountRequested / 100}","${targetRepayment / 100}","${loan.amountRepaid / 100}","${balance / 100}"\n`;
    });

    res.header("Content-Type", "text/csv");
    // Dynamically name the file based on the month
    res.attachment(`ASCON_Payroll_Deductions_${reportMonth.replace(/\s+/g, '_')}.csv`);
    res.status(200).send(csv);
  } catch (error) {
    res.status(500).json({ message: "Server error generating payroll report" });
  }
});

export default router;
