import express from "express";
import Loan from "../models/Loan.js";
import Account from "../models/Account.js";
import Cooperator from "../models/Cooperator.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { sendGuarantorRequestEmail, sendLoanStatusEmail } from "../utils/emailService.js";

const router = express.Router();

// @route   POST /api/loans/request
// @desc    Submit a new loan application with guarantors
// @access  Private
router.post('/request', protect, async (req, res) => {
  try {
    const { amountInKobo, guarantor1FileNumber, guarantor2FileNumber } =
      req.body;

    // 1. Basic validation
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

    // 2. Fetch the applicant's account to check limits
    const account = await Account.findOne({ cooperatorId: req.user.id });
    if (!account || amountInKobo > account.availableCreditLimit) {
      return res
        .status(400)
        .json({ message: "Loan request exceeds your available credit limit." });
    }

    // Prevent spamming
    const existingPending = await Loan.findOne({
      cooperatorId: req.user.id,
      status: { $in: ["PENDING_GUARANTORS", "PENDING_ADMIN"] },
    });
    if (existingPending) {
      return res
        .status(400)
        .json({ message: "You already have an active loan application." });
    }

    // 3. Verify Guarantors exist in the database
    const g1 = await Cooperator.findOne({ fileNumber: guarantor1FileNumber });
    const g2 = await Cooperator.findOne({ fileNumber: guarantor2FileNumber });

    if (!g1 || !g2) {
      return res
        .status(404)
        .json({ message: "One or both guarantor file numbers are invalid." });
    }
    if (
      g1._id.toString() === req.user.id ||
      g2._id.toString() === req.user.id
    ) {
      return res
        .status(400)
        .json({ message: "You cannot guarantee your own loan." });
    }

    // 4. Calculate Interest and Create the Loan Request
    const interestRate = 5; // 5%
    const interestAmount = Math.round(amountInKobo * (interestRate / 100));
    const amountDue = amountInKobo + interestAmount;

    const newLoan = new Loan({
      cooperatorId: req.user.id,
      amountRequested: amountInKobo,
      interestRate: interestRate,
      amountDue: amountDue,
      guarantor1: { cooperatorId: g1._id },
      guarantor2: { cooperatorId: g2._id },
      status: "PENDING_GUARANTORS",
    });

    await newLoan.save();

    // 🚀 NEW: Send automated emails to the guarantors
    // (Assuming you fetched the guarantor User documents earlier to validate them)
    sendGuarantorRequestEmail(
      guarantor1User.email,
      req.user.firstName,
      amountInKobo,
    );
    sendGuarantorRequestEmail(
      guarantor2User.email,
      req.user.firstName,
      amountInKobo,
    );

    res
      .status(201)
      .json({ message: "Loan requested successfully", loan: newLoan });

    res.status(201).json({
      message: "Loan submitted. Waiting for guarantors to accept.",
      loan: newLoan,
    });
  } catch (error) {
    console.error('Loan Request Error:', error);
    res.status(500).json({ message: 'Server error processing loan request' });
  }
});

// @route   GET /api/loans/my-loans
// @desc    Get all loans for the logged-in user
// @access  Private
router.get('/my-loans', protect, async (req, res) => {
  try {
    const loans = await Loan.find({ cooperatorId: req.user.id })
      // NEW: We populate the guarantor details so the frontend can display their names
      .populate('guarantor1.cooperatorId', 'firstName lastName fileNumber')
      .populate('guarantor2.cooperatorId', 'firstName lastName fileNumber')
      .sort({ createdAt: -1 });
      
    res.status(200).json(loans);
  } catch (error) {
    console.error('Fetch Loans Error:', error);
    res.status(500).json({ message: 'Server error fetching loans' });
  }
});

// @route   GET /api/loans/all
// @desc    Get all loans (for Admin Dashboard)
// @access  Private/Admin
router.get('/all', protect, admin, async (req, res) => {
  try {
    // We use .populate() to pull in the Cooperator's name and file number 
    // so the Admin knows exactly who is asking for the money
    const loans = await Loan.find({})
      .populate('cooperatorId', 'firstName lastName fileNumber')
      .sort({ createdAt: -1 });
      
    res.status(200).json(loans);
  } catch (error) {
    console.error('Fetch All Loans Error:', error);
    res.status(500).json({ message: 'Server error fetching cooperative loans' });
  }
});

// @route   PUT /api/loans/:id/review
// @desc    Approve or Reject a loan
// @access  Private/Admin
router.put('/:id/review', protect, admin, async (req, res) => {
  try {
    const { status, adminComment } = req.body;

    // Validate that the status is one of our allowed database enums
    if (!['APPROVED', 'REJECTED', 'REPAID'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status update' });
    }

    const loan = await Loan.findById(req.params.id);
    if (!loan) {
      return res.status(404).json({ message: 'Loan request not found' });
    }

    // Update the loan details
    loan.status = status;
    if (adminComment) {
      loan.adminComment = adminComment;
    }

    await loan.save();

    // 🚀 NEW: Notify the applicant of the Admin's decision
    sendLoanStatusEmail(
      loan.cooperatorId.email,
      loan.cooperatorId.firstName,
      status,
      loan.amountRequested,
    );

    res.status(200).json({ message: `Loan ${status.toLowerCase()}`, loan });

    res.status(200).json({
      message: `Loan successfully marked as ${status}`,
      loan
    });

  } catch (error) {
    console.error('Loan Review Error:', error);
    res.status(500).json({ message: 'Server error reviewing loan' });
  }
});

// @route   POST /api/loans/:id/repay
// @desc    Make a payment towards an approved loan
// @access  Private (Requires Token)
router.post('/:id/repay', protect, async (req, res) => {
  try {
    const { amountInKobo } = req.body;

    if (!amountInKobo || amountInKobo <= 0) {
      return res.status(400).json({ message: "Invalid repayment amount" });
    }

    const loan = await Loan.findOne({
      _id: req.params.id,
      cooperatorId: req.user.id,
    });

    if (!loan) {
      return res.status(404).json({ message: "Loan not found" });
    }

    if (loan.status !== "APPROVED") {
      return res
        .status(400)
        .json({ message: "You can only make payments on APPROVED loans" });
    }

    // Add the payment to the total repaid
    loan.amountRepaid += amountInKobo;

    // Add the payment to the total repaid
    loan.amountRepaid += amountInKobo;

    // THE MAGIC MATH: We use amountDue for new loans, but fallback to amountRequested for your old test loans!
    const targetRepayment = loan.amountDue || loan.amountRequested;

    // Check if the loan is fully paid off
    if (loan.amountRepaid >= targetRepayment) {
      loan.status = "REPAID";

      // Prevent weird overpayment data
      loan.amountRepaid = targetRepayment;
    }

    await loan.save();

    res.status(200).json({
      message:
        loan.status === "REPAID" ? "Loan fully repaid!" : "Payment successful",
      loan,
    });
  } catch (error) {
    console.error('Repayment Error:', error);
    res.status(500).json({ message: 'Server error processing repayment' });
  }
});

// @route   GET /api/loans/guarantor-requests
// @desc    Get all loans where the logged-in user is asked to be a guarantor
// @access  Private
router.get('/guarantor-requests', protect, async (req, res) => {
  try {
    const requests = await Loan.find({
      $or: [
        { 'guarantor1.cooperatorId': req.user.id, 'guarantor1.status': 'PENDING' },
        { 'guarantor2.cooperatorId': req.user.id, 'guarantor2.status': 'PENDING' }
      ]
    }).populate('cooperatorId', 'firstName lastName fileNumber');

    res.status(200).json(requests);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching guarantor requests' });
  }
});

// @route   PUT /api/loans/:id/guarantee
// @desc    Accept or Decline a guarantor request
// @access  Private
router.put('/:id/guarantee', protect, async (req, res) => {
  try {
    const { action } = req.body; // 'ACCEPTED' or 'DECLINED'
    if (!['ACCEPTED', 'DECLINED'].includes(action)) {
      return res.status(400).json({ message: 'Invalid action' });
    }

    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ message: 'Loan not found' });

    // Figure out which guarantor this user is
    const isG1 = loan.guarantor1.cooperatorId.toString() === req.user.id;
    const isG2 = loan.guarantor2.cooperatorId.toString() === req.user.id;

    if (!isG1 && !isG2) {
      return res.status(403).json({ message: 'You are not a guarantor for this loan.' });
    }

    // Update their specific status
    if (isG1) loan.guarantor1.status = action;
    if (isG2) loan.guarantor2.status = action;

    // The Magic Math: Check if BOTH have accepted!
    if (loan.guarantor1.status === 'ACCEPTED' && loan.guarantor2.status === 'ACCEPTED') {
      loan.status = 'PENDING_ADMIN'; // Send it to the boss!
    } else if (action === 'DECLINED') {
      loan.status = 'REJECTED'; // Instantly kill the loan if anyone says no
      loan.adminComment = 'Rejected automatically: A guarantor declined the risk.';
    }

    await loan.save();
    res.status(200).json({ message: `Successfully ${action.toLowerCase()} the request.`, loan });

  } catch (error) {
    res.status(500).json({ message: 'Server error processing guarantee' });
  }
});

// @route   GET /api/loans/payroll-report
// @desc    Generate a CSV file of all active loan balances for HR payroll deduction
// @access  Private/Admin
router.get('/payroll-report', protect, admin, async (req, res) => {
  try {
    // 1. Fetch only loans that are currently active (APPROVED)
    const activeLoans = await Loan.find({ status: 'APPROVED' })
      .populate('cooperatorId', 'firstName lastName fileNumber');

    // 2. Start building the CSV string with the Column Headers
    let csv = 'ASCON File Number,First Name,Last Name,Principal (NGN),Total Due with Interest (NGN),Amount Repaid So Far (NGN),Outstanding Balance to Deduct (NGN)\n';

    // 3. Loop through the loans and add a row for each one
    activeLoans.forEach(loan => {
      // Safety check: skip if the cooperator was somehow deleted
      if (!loan.cooperatorId) return; 

      const targetRepayment = loan.amountDue || loan.amountRequested;
      const balance = targetRepayment - loan.amountRepaid;

      // Convert kobo to standard Naira for the Excel sheet
      const principalNaira = loan.amountRequested / 100;
      const dueNaira = targetRepayment / 100;
      const repaidNaira = loan.amountRepaid / 100;
      const balanceNaira = balance / 100;

      // Add the data row
      csv += `"${loan.cooperatorId.fileNumber}","${loan.cooperatorId.firstName}","${loan.cooperatorId.lastName}","${principalNaira}","${dueNaira}","${repaidNaira}","${balanceNaira}"\n`;
    });

    // 4. Tell the browser that this is a downloadable file, not a regular webpage
    res.header('Content-Type', 'text/csv');
    res.attachment('ASCON_Cooperative_Payroll_Deductions.csv');
    
    // 5. Send the file!
    res.status(200).send(csv);

  } catch (error) {
    console.error('Report Generation Error:', error);
    res.status(500).json({ message: 'Server error generating payroll report' });
  }
});

export default router;
