import express from "express";
import Loan from "../models/Loan.js";
import Account from "../models/Account.js";
import Cooperator from "../models/Cooperator.js";
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
    const { amountInKobo, guarantor1FileNumber, guarantor2FileNumber } = req.body;

    if (!amountInKobo || amountInKobo <= 0) {
      return res.status(400).json({ message: "Invalid loan amount." });
    }
    if (!guarantor1FileNumber || !guarantor2FileNumber) {
      return res.status(400).json({ message: "Two guarantors are strictly required." });
    }
    if (guarantor1FileNumber === guarantor2FileNumber) {
      return res.status(400).json({ message: "You must provide two different guarantors." });
    } 

    const userId = req.user.id || req.user._id;
    const currentUser = await Cooperator.findById(userId); 

    // --- FLAWLESS ACCOUNT VALIDATION ---
    const account = await Account.findOne({ cooperatorId: userId }); 

    if (!account) {
      return res.status(400).json({
        message: "Financial profile missing. Please contact Admin to sync your account.",
      });
    } 

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
      return res.status(400).json({ message: "You already have an active or pending loan." });
    }

    const g1 = await Cooperator.findOne({ fileNumber: guarantor1FileNumber });
    const g2 = await Cooperator.findOne({ fileNumber: guarantor2FileNumber });

    if (!g1 || !g2) {
      return res.status(404).json({ message: "One or both guarantor file numbers are invalid." });
    }

    if (
      g1._id.toString() === userId.toString() ||
      g2._id.toString() === userId.toString()
    ) {
      return res.status(400).json({ message: "You cannot guarantee your own loan." });
    }

    const interestRate = 5; 
    const interestAmount = Math.round(amountInKobo * (interestRate / 100));
    const amountDue = amountInKobo + interestAmount;

    const newLoan = new Loan({
      cooperatorId: userId,
      amountRequested: amountInKobo,
      interestRate: interestRate,
      amountDue: amountDue,
      guarantor1: { cooperatorId: g1._id },
      guarantor2: { cooperatorId: g2._id },
      status: "PENDING_GUARANTORS",
    });

    await newLoan.save();

    // 🚀 FIXED: AWAIT THE EMAILS SO THEY DO NOT GET CANCELLED BY THE SERVER
    await Promise.all([
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
      )
    ]);

    // 🚀 FIXED: ADD THE APPLICANT TO THE NOTIFICATION ARRAY
    await Notification.create([
      {
        user: userId, // Applicant gets a receipt
        title: "Loan Application Submitted",
        message: `Your loan request for ₦${(amountInKobo / 100).toLocaleString()} has been sent to your guarantors.`,
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

      // 🚀 FIXED: Emit a generic update to the applicant so their bell turns red
      if (applicantSocket) io.to(applicantSocket).emit("update_notifications");
      if (g1Socket) io.to(g1Socket).emit("new_guarantor_request", { message: liveMessage });
      if (g2Socket) io.to(g2Socket).emit("new_guarantor_request", { message: liveMessage });
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
// @desc    Get all loans for the logged-in user
// @access  Private
router.get("/my-loans", protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const loans = await Loan.find({ cooperatorId: userId })
      .populate("guarantor1.cooperatorId", "firstName lastName fileNumber")
      .populate("guarantor2.cooperatorId", "firstName lastName fileNumber")
      .sort({ createdAt: -1 });

    res.status(200).json(loans);
  } catch (error) {
    console.error("Fetch Loans Error:", error);
    res.status(500).json({ message: "Server error fetching loans" });
  }
});

// @route   GET /api/loans/all
// @desc    Get all loans (for Admin Dashboard)
// @access  Private/Admin
router.get("/all", protect, admin, async (req, res) => {
  try {
    const loans = await Loan.find({})
      .populate("cooperatorId", "firstName lastName fileNumber")
      .sort({ createdAt: -1 });

    res.status(200).json(loans);
  } catch (error) {
    console.error("Fetch All Loans Error:", error);
    res
      .status(500)
      .json({ message: "Server error fetching cooperative loans" });
  }
});

// @route   PUT /api/loans/:id/review
// @desc    Approve or Reject a loan
// @access  Private/Admin
router.put("/:id/review", protect, admin, async (req, res) => {
  try {
    const { status, adminComment } = req.body;

    if (!["APPROVED", "REJECTED", "REPAID"].includes(status)) {
      return res.status(400).json({ message: "Invalid status update" });
    }

    const loan = await Loan.findById(req.params.id).populate("cooperatorId");
    if (!loan) {
      return res.status(404).json({ message: "Loan request not found" });
    }

    loan.status = status;
    if (adminComment) {
      loan.adminComment = adminComment;
    }

    await loan.save();

    // Write this action to the Immutable Audit Ledger
    logAdminAction(
      req.user.id || req.user._id,
      status === "APPROVED" ? "APPROVED_LOAN" : "REJECTED_LOAN",
      `${status === "APPROVED" ? "Approved" : "Rejected"} a loan of ₦${(loan.amountRequested / 100).toLocaleString()} for ${loan.cooperatorId.fileNumber}`,
      loan._id,
    );

    // Send email to the applicant
    if (loan.cooperatorId && loan.cooperatorId.email) {
      // 🚀 FIXED: Added await
      await sendLoanStatusEmail(
        loan.cooperatorId.email,
        loan.cooperatorId.firstName,
        status,
        loan.amountRequested,
      );
    }

    // Notify the applicant in-app of the Admin's decision
    await Notification.create({
      user: loan.cooperatorId._id,
      title: `Loan ${status === "APPROVED" ? "Approved" : "Rejected"}`,
      message: `Your loan application for ₦${(loan.amountRequested / 100).toLocaleString()} was ${status.toLowerCase()} by the Admin.`,
      type: status === "APPROVED" ? "success" : "danger",
    });

    // 🚀 NEW: Ping the applicant's bell icon
    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");
    if (io && onlineUsers) {
      const targetSocket = onlineUsers.get(loan.cooperatorId._id.toString());
      if (targetSocket) io.to(targetSocket).emit("update_notifications");
    }

    res.status(200).json({
      message: `Loan successfully marked as ${status}`,
      loan,
    });
  } catch (error) {
    console.error("Loan Review Error:", error);
    res.status(500).json({ message: "Server error reviewing loan" });
  }
});

// @route   POST /api/loans/:id/repay
// @desc    Make a payment towards an approved loan
// @access  Private (Requires Token)
router.post("/:id/repay", protect, async (req, res) => {
  try {
    const { amountInKobo } = req.body;

    if (!amountInKobo || amountInKobo <= 0) {
      return res.status(400).json({ message: "Invalid repayment amount" });
    }

    const userId = req.user.id || req.user._id;

    const loan = await Loan.findOne({
      _id: req.params.id,
      cooperatorId: userId,
    });

    if (!loan) {
      return res.status(404).json({ message: "Loan not found" });
    }

    if (loan.status !== "APPROVED") {
      return res
        .status(400)
        .json({ message: "You can only make payments on APPROVED loans" });
    }

    loan.amountRepaid += amountInKobo;

    const targetRepayment = loan.amountDue || loan.amountRequested;

    if (loan.amountRepaid >= targetRepayment) {
      loan.status = "REPAID";
      loan.amountRepaid = targetRepayment;
    }

    await loan.save();

    // Send a financial alert for the receipt
    await Notification.create({
      user: userId,
      title:
        loan.status === "REPAID" ? "Loan Fully Repaid" : "Payment Received",
      message: `Your repayment of ₦${(amountInKobo / 100).toLocaleString()} was processed successfully.${loan.status === "REPAID" ? " Your loan is now fully settled." : ""}`,
      type: "financial",
    });

    // 🚀 NEW: Ping the user's bell icon
    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");
    if (io && onlineUsers) {
      const targetSocket = onlineUsers.get(userId.toString());
      if (targetSocket) io.to(targetSocket).emit("update_notifications");
    }

    res.status(200).json({
      message:
        loan.status === "REPAID" ? "Loan fully repaid!" : "Payment successful",
      loan,
    });
  } catch (error) {
    console.error("Repayment Error:", error);
    res.status(500).json({ message: "Server error processing repayment" });
  }
});

// @route   GET /api/loans/guarantor-requests
// @desc    Get all loans where the logged-in user is asked to be a guarantor
// @access  Private
router.get("/guarantor-requests", protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const requests = await Loan.find({
      $or: [
        {
          "guarantor1.cooperatorId": userId,
          "guarantor1.status": "PENDING",
        },
        {
          "guarantor2.cooperatorId": userId,
          "guarantor2.status": "PENDING",
        },
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
// @desc    Accept or Decline a guarantor request
// @access  Private
router.put("/:id/guarantee", protect, async (req, res) => {
  try {
    const { action } = req.body;
    if (!["ACCEPTED", "DECLINED"].includes(action)) {
      return res.status(400).json({ message: "Invalid action" });
    }

    // 🚀 FIXED: Populate the cooperator so we can inject their real name into the Admin email
    const loan = await Loan.findById(req.params.id).populate(
      "cooperatorId",
      "firstName lastName",
    );
    if (!loan) return res.status(404).json({ message: "Loan not found" });

    // 🚀 FIXED: Safely extract the guarantor's ID from the JWT payload
    const userId = req.user.id || req.user._id;

    const isG1 = loan.guarantor1.cooperatorId.toString() === userId.toString();
    const isG2 = loan.guarantor2.cooperatorId.toString() === userId.toString();

    if (!isG1 && !isG2) {
      return res
        .status(403)
        .json({ message: "You are not a guarantor for this loan." });
    }

    if (isG1) loan.guarantor1.status = action;
    if (isG2) loan.guarantor2.status = action;

    if (
      loan.guarantor1.status === "ACCEPTED" &&
      loan.guarantor2.status === "ACCEPTED"
    ) {
      loan.status = "PENDING_ADMIN";

      // Fire email to all Admins since it is now ready for review
      const admins = await Cooperator.find({
        role: { $in: ["ADMIN", "SUPER_ADMIN"] },
      });

      // 🚀 FIXED: Await the email transporter and inject the applicant's real name
      const emailPromises = admins.map((admin) =>
        sendAdminApprovalEmail(
          admin.email,
          `${loan.cooperatorId.firstName} ${loan.cooperatorId.lastName}`, // Real name injected
          loan.amountRequested,
          loan._id,
        ),
      );
      await Promise.all(emailPromises);
    } else if (action === "DECLINED") {
      loan.status = "REJECTED";
      loan.adminComment =
        "Rejected automatically: A guarantor declined the risk.";
    }

    await loan.save();

    // Notify the applicant of the guarantor's decision
    await Notification.create({
      user: loan.cooperatorId._id,
      title: `Guarantor ${action === "ACCEPTED" ? "Accepted" : "Declined"}`,
      message: `A guarantor has ${action.toLowerCase()} your request.`,
      type: action === "ACCEPTED" ? "success" : "danger",
    });

    // 🚀 NEW: Ping the applicant's bell icon
    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");
    if (io && onlineUsers) {
      const targetSocket = onlineUsers.get(loan.cooperatorId._id.toString());
      if (targetSocket) io.to(targetSocket).emit("update_notifications");
    }

    res.status(200).json({
      message: `Successfully ${action.toLowerCase()} the request.`,
      loan,
    });
  } catch (error) {
    console.error("Guarantor Action Error:", error);
    res.status(500).json({ message: "Server error processing guarantee" });
  }
});

// @route   GET /api/loans/payroll-report
// @desc    Generate a CSV file of all active loan balances for HR payroll deduction
// @access  Private/Admin
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

      const principalNaira = loan.amountRequested / 100;
      const dueNaira = targetRepayment / 100;
      const repaidNaira = loan.amountRepaid / 100;
      const balanceNaira = balance / 100;

      csv += `"${loan.cooperatorId.fileNumber}","${loan.cooperatorId.firstName}","${loan.cooperatorId.lastName}","${principalNaira}","${dueNaira}","${repaidNaira}","${balanceNaira}"\n`;
    });

    res.header("Content-Type", "text/csv");
    res.attachment("ASCON_Cooperative_Payroll_Deductions.csv");
    res.status(200).send(csv);
  } catch (error) {
    console.error("Report Generation Error:", error);
    res.status(500).json({ message: "Server error generating payroll report" });
  }
});

export default router;
