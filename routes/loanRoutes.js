import express from "express";
import Loan from "../models/Loan.js";
import Account from "../models/Account.js";
import Cooperator from "../models/Cooperator.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  sendGuarantorRequestEmail,
  sendLoanStatusEmail,
} from "../utils/emailService.js";
import Notification from "../models/Notification.js";

const router = express.Router();

// @route   POST /api/loans/request
// @desc    Submit a new loan application with guarantors
// @access  Private
router.post("/request", protect, async (req, res) => {
  try {
    const { amountInKobo, guarantor1FileNumber, guarantor2FileNumber } =
      req.body;

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

    const account = await Account.findOne({ cooperatorId: req.user._id });
    if (!account || amountInKobo > account.availableCreditLimit) {
      return res
        .status(400)
        .json({ message: "Loan request exceeds your available credit limit." });
    }

    const existingPending = await Loan.findOne({
      cooperatorId: req.user._id,
      status: { $in: ["PENDING_GUARANTORS", "PENDING_ADMIN"] },
    });
    if (existingPending) {
      return res
        .status(400)
        .json({ message: "You already have an active loan application." });
    }

    const g1 = await Cooperator.findOne({ fileNumber: guarantor1FileNumber });
    const g2 = await Cooperator.findOne({ fileNumber: guarantor2FileNumber });

    if (!g1 || !g2) {
      return res
        .status(404)
        .json({ message: "One or both guarantor file numbers are invalid." });
    }
    if (
      g1._id.toString() === req.user._id.toString() ||
      g2._id.toString() === req.user._id.toString()
    ) {
      return res
        .status(400)
        .json({ message: "You cannot guarantee your own loan." });
    }

    const interestRate = 5; // 5%
    const interestAmount = Math.round(amountInKobo * (interestRate / 100));
    const amountDue = amountInKobo + interestAmount;

    const newLoan = new Loan({
      cooperatorId: req.user._id,
      amountRequested: amountInKobo,
      interestRate: interestRate,
      amountDue: amountDue,
      guarantor1: { cooperatorId: g1._id },
      guarantor2: { cooperatorId: g2._id },
      status: "PENDING_GUARANTORS",
    });

    await newLoan.save();

    sendGuarantorRequestEmail(g1.email, req.user.firstName, amountInKobo);
    sendGuarantorRequestEmail(g2.email, req.user.firstName, amountInKobo);

    // 🚀 NEW: Generate in-app notifications for both guarantors
    await Notification.create([
      {
        user: g1._id,
        title: "Guarantor Request",
        message: `${req.user.firstName} requested you as a guarantor for a loan of ₦${(amountInKobo / 100).toLocaleString()}.`,
        type: "info",
      },
      {
        user: g2._id,
        title: "Guarantor Request",
        message: `${req.user.firstName} requested you as a guarantor for a loan of ₦${(amountInKobo / 100).toLocaleString()}.`,
        type: "info",
      },
    ]);

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
    const loans = await Loan.find({ cooperatorId: req.user._id })
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

    // Send email to the applicant
    if (loan.cooperatorId && loan.cooperatorId.email) {
      sendLoanStatusEmail(
        loan.cooperatorId.email,
        loan.cooperatorId.firstName,
        status,
        loan.amountRequested,
      );
    }

    // 🚀 NEW: Notify the applicant in-app of the Admin's decision
    await Notification.create({
      user: loan.cooperatorId._id,
      title: `Loan ${status === "APPROVED" ? "Approved" : "Rejected"}`,
      message: `Your loan application for ₦${(loan.amountRequested / 100).toLocaleString()} was ${status.toLowerCase()} by the Admin.`,
      type: status === "APPROVED" ? "success" : "danger",
    });

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

    const loan = await Loan.findOne({
      _id: req.params.id,
      cooperatorId: req.user._id,
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

    // 🚀 NEW: Send a financial alert for the receipt
    await Notification.create({
      user: req.user._id,
      title:
        loan.status === "REPAID" ? "Loan Fully Repaid" : "Payment Received",
      message: `Your repayment of ₦${(amountInKobo / 100).toLocaleString()} was processed successfully.${loan.status === "REPAID" ? " Your loan is now fully settled." : ""}`,
      type: "financial",
    });

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
    const requests = await Loan.find({
      $or: [
        {
          "guarantor1.cooperatorId": req.user._id,
          "guarantor1.status": "PENDING",
        },
        {
          "guarantor2.cooperatorId": req.user._id,
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

    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ message: "Loan not found" });

    const isG1 =
      loan.guarantor1.cooperatorId.toString() === req.user._id.toString();
    const isG2 =
      loan.guarantor2.cooperatorId.toString() === req.user._id.toString();

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
    } else if (action === "DECLINED") {
      loan.status = "REJECTED";
      loan.adminComment =
        "Rejected automatically: A guarantor declined the risk.";
    }

    await loan.save();

    // 🚀 NEW: Notify the applicant of the guarantor's decision
    await Notification.create({
      user: loan.cooperatorId,
      title: `Guarantor ${action === "ACCEPTED" ? "Accepted" : "Declined"}`,
      message: `A guarantor has ${action.toLowerCase()} your request.`,
      type: action === "ACCEPTED" ? "success" : "danger",
    });

    res.status(200).json({
      message: `Successfully ${action.toLowerCase()} the request.`,
      loan,
    });
  } catch (error) {
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
