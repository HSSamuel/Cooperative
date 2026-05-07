import express from "express";
import Loan from "../models/Loan.js";
import Account from "../models/Account.js";
import Cooperator from "../models/Cooperator.js";
import Transaction from "../models/Transaction.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  sendGuarantorRequestEmail,
  sendLoanStatusEmail,
  sendAdminApprovalEmail,
} from "../utils/emailService.js";
import Notification from "../models/Notification.js";
import { logAdminAction } from "../utils/auditLogger.js";

const router = express.Router();

// @route   POST /api/loans/request
// @desc    Submit a new loan application with guarantors
// @access  Private
router.post("/request", protect, async (req, res) => {
  try {
    // 🚀 THE FIX: Extracted loanType here to prevent the ReferenceError
    const {
      amountInKobo,
      guarantor1FileNumber,
      guarantor2FileNumber,
      loanType,
    } = req.body;

    if (!amountInKobo || amountInKobo <= 0) {
      return res.status(400).json({ message: "Invalid loan amount." });
    }
    if (!guarantor1FileNumber || !guarantor2FileNumber) {
      return res
        .status(400)
        .json({ message: "Two guarantors are strictly required." });
    }
    if (guarantor1FileNumber === guarantor2FileNumber) {
      return res
        .status(400)
        .json({ message: "You must provide two different guarantors." });
    }

    const userId = req.user.id || req.user._id;
    const currentUser = await Cooperator.findById(userId);

    const account = await Account.findOne({ cooperatorId: userId });

    if (!account) {
      return res.status(400).json({
        message:
          "Financial profile missing. Please contact Admin to sync your account.",
      });
    }

    // 🚀 FIX 1: ENFORCE 6-MONTH PROBATION RULE
    // (Currently commented out for testing purposes)
    /*
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const joinDate = currentUser.dateJoined || currentUser.createdAt;
    
    if (new Date(joinDate) > sixMonthsAgo) {
      return res.status(403).json({
        message: "Probation Active: You must be a registered member for at least 6 months to unlock loan eligibility.",
      });
    }
    */

    if (amountInKobo > account.availableCreditLimit) {
      return res.status(400).json({
        message: `Request exceeds your available credit limit of ₦${(account.availableCreditLimit / 100).toLocaleString()}.`,
      });
    }

    const existingPending = await Loan.findOne({
      cooperatorId: userId,
      status: { $in: ["PENDING_GUARANTORS", "PENDING_ADMIN", "APPROVED"] },
    });

    if (existingPending) {
      return res
        .status(400)
        .json({ message: "You already have an active or pending loan." });
    }

    const g1 = await Cooperator.findOne({ fileNumber: guarantor1FileNumber });
    const g2 = await Cooperator.findOne({ fileNumber: guarantor2FileNumber });

    if (!g1 || !g2) {
      return res
        .status(404)
        .json({ message: "One or both guarantor file numbers are invalid." });
    }

    if (
      g1._id.toString() === userId.toString() ||
      g2._id.toString() === userId.toString()
    ) {
      return res
        .status(400)
        .json({ message: "You cannot guarantee your own loan." });
    }

    const interestRate = 5;
    const interestAmount = Math.round(amountInKobo * (interestRate / 100));
    const amountDue = amountInKobo + interestAmount;

    const newLoan = new Loan({
      cooperatorId: userId,
      loanType: loanType || "REGULAR", // Now works flawlessly
      amountRequested: amountInKobo,
      interestRate: interestRate,
      amountDue: amountDue,
      guarantor1: { cooperatorId: g1._id },
      guarantor2: { cooperatorId: g2._id },
      status: "PENDING_GUARANTORS",
    });

    await newLoan.save();

    // TRULY Non-blocking email execution
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
      console.error(
        "Non-fatal: Email delivery failed. Relying on in-app notifications.",
        emailError.message,
      );
    });

    await Notification.create([
      {
        user: userId,
        title: "Loan Application Submitted",
        message: `Your ${loanType || "REGULAR"} loan request for ₦${(amountInKobo / 100).toLocaleString()} has been sent to your guarantors.`,
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

    // Trigger Live WebSockets
    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    if (io && onlineUsers) {
      const applicantSocket = onlineUsers.get(userId.toString());
      const g1Socket = onlineUsers.get(g1._id.toString());
      const g2Socket = onlineUsers.get(g2._id.toString());

      const liveMessage = `${currentUser.firstName} just requested you as a loan guarantor.`;

      if (applicantSocket) io.to(applicantSocket).emit("update_notifications");
      if (g1Socket)
        io.to(g1Socket).emit("new_guarantor_request", { message: liveMessage });
      if (g2Socket)
        io.to(g2Socket).emit("new_guarantor_request", { message: liveMessage });
    }

    res.status(201).json({
      message: "Loan submitted. Waiting for guarantors to accept.",
      loan: newLoan,
    });
  } catch (error) {
    console.error("Loan Request Error:", error);
    res.status(500).json({ message: "Server error processing loan request" });
  }
});

// @route   GET /api/loans/my-loans
router.get("/my-loans", protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const loans = await Loan.find({ cooperatorId: userId })
      .populate("guarantor1.cooperatorId", "firstName lastName fileNumber")
      .populate("guarantor2.cooperatorId", "firstName lastName fileNumber")
      .sort({ createdAt: -1 });

    res.status(200).json(loans);
  } catch (error) {
    res.status(500).json({ message: "Server error fetching loans" });
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
      try {
        await sendLoanStatusEmail(
          loan.cooperatorId.email,
          loan.cooperatorId.firstName,
          status,
          loan.amountRequested,
        );
      } catch (err) {
        console.error("Email failed on admin review", err);
      }
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
router.post("/:id/repay", protect, async (req, res) => {
  try {
    const { amountInKobo } = req.body;

    if (!amountInKobo || amountInKobo <= 0) {
      return res.status(400).json({ message: "Invalid repayment amount" });
    }

    const userId = req.user.id || req.user._id;

    // 1. Fetch Loan first to calculate exact actualRepayment
    const loan = await Loan.findOne({ _id: req.params.id, cooperatorId: userId });
    
    if (!loan) return res.status(404).json({ message: "Loan not found" });
    if (loan.status !== "APPROVED") {
      return res.status(400).json({ message: "You can only make payments on APPROVED loans" });
    }

    const targetRepayment = loan.amountDue || loan.amountRequested;
    const remainingBalance = targetRepayment - loan.amountRepaid;
    const actualRepayment = Math.min(amountInKobo, remainingBalance);

    // 🚀 FIX 2: Atomic Database Deduction (Prevents Double-Spend)
    // We only deduct IF totalSavings is greater than or equal to the repayment.
    const account = await Account.findOneAndUpdate(
      { 
        cooperatorId: userId, 
        totalSavings: { $gte: actualRepayment } // Strict DB-level check
      },
      {
        $inc: {
          totalSavings: -actualRepayment,
          availableCreditLimit: -(actualRepayment * 2) // Maintain the 2x ratio atomically
        }
      },
      { new: true } // Return the updated document
    );

    if (!account) {
      return res.status(400).json({
        message: "Insufficient savings to process this repayment. Transaction aborted.",
      });
    }

    // 3. Update Loan Status
    loan.amountRepaid += actualRepayment;
    if (loan.amountRepaid >= targetRepayment) {
      loan.status = "REPAID";
      loan.amountRepaid = targetRepayment;
    }
    await loan.save();

    // 4. Log Transaction
    const currentMonthString = new Date().toLocaleString("en-GB", {
      month: "long",
      year: "numeric",
    });
    
    await Transaction.create({
      cooperatorId: userId,
      type: "DEBIT",
      amount: actualRepayment,
      description: `Self-Initiated Loan Repayment. Remaining Loan Balance: ₦${((targetRepayment - loan.amountRepaid) / 100).toLocaleString()}`,
      effectiveMonth: currentMonthString,
      balanceAfter: account.totalSavings,
    });

    await Notification.create({
      user: userId,
      title: loan.status === "REPAID" ? "Loan Fully Repaid" : "Payment Received",
      message: `Your repayment of ₦${(actualRepayment / 100).toLocaleString()} was processed successfully and deducted from your savings.${loan.status === "REPAID" ? " Your loan is now fully settled." : ""}`,
      type: "financial",
    });

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");
    if (io && onlineUsers) {
      const targetSocket = onlineUsers.get(userId.toString());
      if (targetSocket) io.to(targetSocket).emit("update_notifications");
    }

    res.status(200).json({
      message: loan.status === "REPAID" ? "Loan fully repaid!" : "Payment successful",
      loan,
    });
  } catch (error) {
    console.error("Repayment Error:", error);
    res.status(500).json({ message: "Server error processing repayment" });
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

    if (
      loan.guarantor1.status === "ACCEPTED" &&
      loan.guarantor2.status === "ACCEPTED"
    ) {
      loan.status = "PENDING_ADMIN";

      const admins = await Cooperator.find({
        role: { $in: ["ADMIN", "SUPER_ADMIN"] },
      });
      
      const emailPromises = admins.map((admin) =>
        sendAdminApprovalEmail(
          admin.email,
          `${loan.cooperatorId.firstName} ${loan.cooperatorId.lastName}`,
          loan.amountRequested,
          loan._id,
        ),
      );

      // 🚀 THE FIX: Truly non-blocking background email execution
      Promise.all(emailPromises).catch((err) => {
        console.error("Non-fatal: Admin email failed in background", err.message);
      });

    } else if (action === "DECLINED") {
      loan.status = "REJECTED";
      loan.adminComment =
        "Rejected automatically: A guarantor declined the risk.";
    }

    await loan.save();

    await Notification.create({
      user: loan.cooperatorId._id,
      title: `Guarantor ${action === "ACCEPTED" ? "Accepted" : "Declined"}`,
      message: `A guarantor has ${action.toLowerCase()} your request.`,
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
    let csv =
      "ASCON File Number,First Name,Last Name,Principal (NGN),Total Due with Interest (NGN),Amount Repaid So Far (NGN),Outstanding Balance to Deduct (NGN)\n";

    activeLoans.forEach((loan) => {
      if (!loan.cooperatorId) return;
      const targetRepayment = loan.amountDue || loan.amountRequested;
      const balance = targetRepayment - loan.amountRepaid;
      csv += `"${loan.cooperatorId.fileNumber}","${loan.cooperatorId.firstName}","${loan.cooperatorId.lastName}","${loan.amountRequested / 100}","${targetRepayment / 100}","${loan.amountRepaid / 100}","${balance / 100}"\n`;
    });

    res.header("Content-Type", "text/csv");
    res.attachment("ASCON_Cooperative_Payroll_Deductions.csv");
    res.status(200).send(csv);
  } catch (error) {
    res.status(500).json({ message: "Server error generating payroll report" });
  }
});

export default router;
