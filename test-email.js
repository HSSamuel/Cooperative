import dotenv from "dotenv";

// 1. Force the .env variables to load BEFORE anything else
dotenv.config();

const runTest = async () => {
  console.log("🚀 Initializing Brevo Test Protocol...");

  // You can put ANY email address here to receive the test emails
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
      "test-loan-id-123", // Mock loanId for the Magic Links
    );

    console.log("📨 Sending Test Loan Approval...");
    await sendLoanStatusEmail(
      myTestEmail,
      "Test Cooperator",
      "APPROVED",
      5000000,
    );

    console.log(
      "✅ Brevo API commands dispatched successfully! Check your inbox.",
    );
  } catch (error) {
    console.error(
      "❌ Test Failed. Check your Brevo API Key and network connection:",
      error,
    );
  }
};

runTest();
