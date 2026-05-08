import dotenv from "dotenv";

dotenv.config();

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const senderEmail = process.env.EMAIL_FROM;

// Helper to reliably grab the frontend URL
const getFrontendUrl = () =>
  process.env.FRONTEND_URL ||
  process.env.NEXT_PUBLIC_FRONTEND_URL ||
  "http://localhost:3000";

// 1. Generic Send Function using Native Fetch (Bypasses Render SMTP Block)
const sendEmail = async ({ to, subject, html }) => {
  try {
    const response = await fetch(BREVO_API_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": process.env.BREVO_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: {
          name: "ASCON Cooperative",
          email: senderEmail,
        },
        to: [{ email: to }],
        subject: subject,
        htmlContent: html,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error(`❌ Brevo API Error sending to ${to}:`, errorData);
      throw new Error("Failed to dispatch email via Brevo");
    }

    console.log(`✉️ Brevo: Email securely dispatched to ${to}`);
  } catch (error) {
    console.error(
      `❌ Network/SDK failure sending email to ${to}:`,
      error.message,
    );
    throw error;
  }
};

// 2. Pre-built HTML Templates for our specific actions

export const sendGuarantorRequestEmail = async (
  guarantorEmail,
  applicantName,
  amountInKobo,
  loanId,
) => {
  const amount = (amountInKobo / 100).toLocaleString("en-NG", {
    style: "currency",
    currency: "NGN",
  });

  const frontendUrl = getFrontendUrl();
  const acceptUrl = `${frontendUrl}/action/guarantee?loanId=${loanId}&action=ACCEPTED`;
  const declineUrl = `${frontendUrl}/action/guarantee?loanId=${loanId}&action=DECLINED`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background-color: #1b5e3a; padding: 24px; text-align: center; color: white;">
        <h2 style="margin: 0;">Guarantor Action Required</h2>
      </div>
      <div style="padding: 32px; background-color: #f8fafc; color: #334155;">
        <p style="font-size: 16px;">Hello,</p>
        <p style="font-size: 16px;"><strong>${applicantName}</strong> has requested a cooperative loan of <strong>${amount}</strong> and has listed you as a guarantor.</p>
        <p style="font-size: 16px;">You can process this request immediately using the secure links below:</p>
        
        <div style="display: flex; gap: 16px; justify-content: center; margin-top: 32px;">
          <a href="${acceptUrl}" style="background-color: #1b5e3a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; flex: 1; text-align: center;">Accept Request</a>
          <a href="${declineUrl}" style="background-color: #ef4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; flex: 1; text-align: center;">Decline Request</a>
        </div>
        
        <p style="font-size: 14px; color: #64748b; margin-top: 24px; text-align: center;">Note: You will be asked to log in if your secure session has expired.</p>
      </div>
    </div>
  `;
  await sendEmail({
    to: guarantorEmail,
    subject: "Action Required: Guarantor Request",
    html,
  });
};

export const sendAdminApprovalEmail = async (
  adminEmail,
  applicantName,
  amountInKobo,
  loanId,
) => {
  const amount = (amountInKobo / 100).toLocaleString("en-NG", {
    style: "currency",
    currency: "NGN",
  });

  const frontendUrl = getFrontendUrl();
  const approveUrl = `${frontendUrl}/admin/action/review?loanId=${loanId}&action=APPROVED`;
  const rejectUrl = `${frontendUrl}/admin/action/review?loanId=${loanId}&action=REJECTED`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background-color: #f59e0b; padding: 24px; text-align: center; color: white;">
        <h2 style="margin: 0;">Admin Review Required</h2>
      </div>
      <div style="padding: 32px; background-color: #f8fafc; color: #334155;">
        <p style="font-size: 16px;">Hello Admin,</p>
        <p style="font-size: 16px;"><strong>${applicantName}</strong> has successfully secured both guarantors for their loan request of <strong>${amount}</strong>.</p>
        <p style="font-size: 16px;">This application is now awaiting your final executive review.</p>
        
        <div style="display: flex; gap: 16px; justify-content: center; margin-top: 32px;">
          <a href="${approveUrl}" style="background-color: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; flex: 1; text-align: center;">Approve Loan</a>
          <a href="${rejectUrl}" style="background-color: #ef4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; flex: 1; text-align: center;">Reject Loan</a>
        </div>
        
        <p style="font-size: 14px; color: #64748b; margin-top: 24px; text-align: center;">Note: You will be asked to log in if your admin session has expired.</p>
      </div>
    </div>
  `;
  await sendEmail({
    to: adminEmail,
    subject: "Admin Action Required: New Loan Ready for Review",
    html,
  });
};

export const sendLoanStatusEmail = async (
  applicantEmail,
  applicantName,
  status,
  amountInKobo,
) => {
  const amount = (amountInKobo / 100).toLocaleString("en-NG", {
    style: "currency",
    currency: "NGN",
  });
  const isApproved = status === "APPROVED";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background-color: ${isApproved ? "#10b981" : "#ef4444"}; padding: 24px; text-align: center; color: white;">
        <h2 style="margin: 0;">Loan ${isApproved ? "Approved!" : "Rejected"}</h2>
      </div>
      <div style="padding: 32px; background-color: #f8fafc; color: #334155;">
        <p style="font-size: 16px;">Hello ${applicantName},</p>
        <p style="font-size: 16px;">Your loan request for <strong>${amount}</strong> has been <strong>${status.toLowerCase()}</strong> by the cooperative administration.</p>
        ${isApproved ? '<p style="font-size: 16px;">The funds will be disbursed according to standard cooperative procedures.</p>' : '<p style="font-size: 16px;">If you have questions, please contact the cooperative administration.</p>'}
        <div style="text-align: center; margin-top: 32px;">
          <a href="${getFrontendUrl()}/dashboard/loans" style="background-color: #334155; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">View Your Ledger</a>
        </div>
      </div>
    </div>
  `;
  await sendEmail({
    to: applicantEmail,
    subject: `Loan Application ${isApproved ? "Approved" : "Rejected"}`,
    html,
  });
};

export const sendPasswordResetEmail = async (email, firstName, resetUrl) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
      <h2 style="color: #1b5e3a;">Password Reset Request</h2>
      <p>Hello ${firstName},</p>
      <p>You recently requested to reset your password for your ASCON Cooperative account. Click the button below to reset it. <strong>This link is only valid for 10 minutes.</strong></p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${resetUrl}" style="background-color: #1b5e3a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset My Password</a>
      </div>
      <p>If you did not request a password reset, please ignore this email or reply to let us know. Your password will remain unchanged.</p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
      <p style="font-size: 12px; color: #64748b; text-align: center;">ASCON Cooperative Society &copy; ${new Date().getFullYear()}</p>
    </div>
  `;

  await sendEmail({
    to: email,
    subject: "Password Reset Request - ASCON Cooperative",
    html,
  });
};
