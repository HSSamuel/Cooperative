import nodemailer from "nodemailer";

// 1. Configure the Transporter (The Mailman)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // NOTE: Use a Gmail "App Password", not your real password!
  },
});

// 2. Generic Send Function
const sendEmail = async ({ to, subject, html }) => {
  try {
    await transporter.sendMail({
      from: `"ASCON Cooperative" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });
    console.log(`✉️ Email securely sent to ${to}`);
  } catch (error) {
    console.error(`❌ Failed to send email to ${to}:`, error);
  }
};

// 3. Pre-built HTML Templates for our specific actions

export const sendGuarantorRequestEmail = async (
  guarantorEmail,
  applicantName,
  amountInKobo,
) => {
  const amount = (amountInKobo / 100).toLocaleString("en-NG", {
    style: "currency",
    currency: "NGN",
  });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background-color: #1b5e3a; padding: 24px; text-align: center; color: white;">
        <h2 style="margin: 0;">Guarantor Action Required</h2>
      </div>
      <div style="padding: 32px; background-color: #f8fafc; color: #334155;">
        <p style="font-size: 16px;">Hello,</p>
        <p style="font-size: 16px;"><strong>${applicantName}</strong> has requested a cooperative loan of <strong>${amount}</strong> and has listed you as a guarantor.</p>
        <p style="font-size: 16px;">Please log in to your ASCON Cooperative Dashboard immediately to review and accept or decline this request.</p>
        <div style="text-align: center; margin-top: 32px;">
          <a href="${process.env.FRONTEND_URL}/dashboard/guarantors" style="background-color: #1b5e3a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Review Request Now</a>
        </div>
      </div>
    </div>
  `;
  await sendEmail({
    to: guarantorEmail,
    subject: "Action Required: Guarantor Request",
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
          <a href="${process.env.FRONTEND_URL}/dashboard/loans" style="background-color: #334155; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">View Your Ledger</a>
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
  try {
    const mailOptions = {
      from: `"ASCON Cooperative" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Password Reset Request - ASCON Cooperative",
      html: `
        <div style="font-family: Arial, sans-serif; max-w: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
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
      `,
    };

    // Assuming you have a transporter setup in this file
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error("Error sending password reset email:", error);
    throw new Error("Email could not be sent");
  }
};