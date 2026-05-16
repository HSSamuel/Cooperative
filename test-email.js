import dotenv from "dotenv";

dotenv.config();

const runTest = async () => {
  console.log("🚀 Initializing Nodemailer OAuth2 Test Protocol...");

  // You can put ANY email address here to receive the test emails
  const myTestEmail = "smkmayomisamuel@gmail.com";

  try {
    const { sendGuarantorRequestEmail, sendLoanStatusEmail } =
      await import("./utils/emailService.js");

    console.log("📨 Sending Test Guarantor Request...");
    await sendGuarantorRequestEmail(
      myTestEmail,
      "Test Cooperator",
      5000000,
      "test-loan-id-123",
    );

    console.log("📨 Sending Test Loan Approval...");
    await sendLoanStatusEmail(
      myTestEmail,
      "Test Cooperator",
      "APPROVED",
      5000000,
    );

    console.log(
      "✅ Nodemailer OAuth2 API commands dispatched successfully! Check your inbox.",
    );
  } catch (error) {
    console.error("❌ Test Failed:", error);
  }
};

runTest();
