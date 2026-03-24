// services/emailService.ts
// ─────────────────────────────────────────────
// Email service for sending OTPs and notifications
// ─────────────────────────────────────────────

import nodemailer from 'nodemailer';
import logger from '../utils/logger';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_PORT === '465', // true for port 465, false for others
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendOtpEmail = async (toEmail: string, otpCode: string | number) => {
  try {
    const mailOptions = {
      from: `"O'Future Security" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: "O'Future - Account Verification OTP",
      // Pure text backend response
      text: `Hello,\n\nYour account verification OTP is: ${otpCode}\n\nThis code will expire in 5 minutes. Please do not share this code with anyone.\n\nBest regards,\nO'Future Security System`,
    };
    
    await transporter.sendMail(mailOptions);
    logger.info(`Successfully sent OTP email to ${toEmail}`);
  } catch (error) {
    logger.error(`Failed to send OTP email to ${toEmail}:`, error);
    throw new Error('Failed to send email');
  }
};

export = { sendOtpEmail };