import dotenv from "dotenv";

// 1. Force the .env variables to load BEFORE anything else
dotenv.config();

const runTest = async () => {
  console.log("🚀 Initializing Email Test Protocol...");

  // IMPORTANT: Make sure this is your actual email!
  const myTestEmail = "hssamuel2024@gmail.com";

  try {
    // 2. DYNAMICALLY import the email service ONLY AFTER the env variables are loaded
    const { sendGuarantorRequestEmail, sendLoanStatusEmail } =
      await import("./utils/emailService.js");

    console.log("📨 Sending Test Guarantor Request...");
    await sendGuarantorRequestEmail(myTestEmail, "Test Cooperator", 5000000);

    console.log("📨 Sending Test Loan Approval...");
    await sendLoanStatusEmail(
      myTestEmail,
      "Test Cooperator",
      "APPROVED",
      5000000,
    );

    console.log("✅ Engine executed successfully! Go check your inbox.");
    process.exit(0);
  } catch (error) {
    console.error(
      "❌ Test Failed. Check your NodeMailer configuration:",
      error,
    );
    process.exit(1);
  }
};

runTest();
