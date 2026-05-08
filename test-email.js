import dotenv from "dotenv";

// 1. Force the .env variables to load BEFORE anything else
dotenv.config();

const runTest = async () => {
  console.log("🚀 Initializing Email Test Protocol...");

  // Replace this with the email address where you want to receive the test emails
  const myTestEmail = "hssamuel2024@gmail.com";

  try {
    // 2. DYNAMICALLY import the email service ONLY AFTER the env variables are loaded
    const { sendGuarantorRequestEmail, sendLoanStatusEmail } =
      await import("./utils/emailService.js");

    console.log("📨 Sending Test Guarantor Request...");
    await sendGuarantorRequestEmail(
      myTestEmail,
      "Test Cooperator",
      5000000,
      "test-loan-id-123", // Added mock loanId for the Magic Links
    );

    console.log("📨 Sending Test Loan Approval...");
    await sendLoanStatusEmail(
      myTestEmail,
      "Test Cooperator",
      "APPROVED",
      5000000,
    );

    console.log("✅ Engine executed successfully! Go check your inbox.");

    // Note: process.exit(0) was intentionally removed here to prevent
    // the Node.js event loop from crashing on Windows while sockets are closing.
  } catch (error) {
    console.error(
      "❌ Test Failed. Check your NodeMailer configuration:",
      error,
    );
    // Note: process.exit(1) was intentionally removed here as well.
  }
};

runTest();
