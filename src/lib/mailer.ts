import nodemailer, { Transporter } from "nodemailer";

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, ""),
    },
  });
  return transporter;
}

interface SendMailArgs {
  to: string[];
  subject: string;
  html: string;
  text: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
}

// Best-effort — never throws. A flaky SMTP send must never break the
// apply/approve/reject/comment request that triggered it. Gated behind
// LEAVE_EMAILS_ENABLED so wiring this in doesn't immediately start emailing
// real people the moment credentials exist.
export async function sendMail(args: SendMailArgs): Promise<boolean> {
  if (process.env.LEAVE_EMAILS_ENABLED !== "true") {
    console.log(`[mailer] disabled — would have sent "${args.subject}" to ${args.to.join(", ")}`);
    return false;
  }
  if (args.to.length === 0) return false;

  try {
    await getTransporter().sendMail({
      from: process.env.MAIL_FROM,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      messageId: args.messageId,
      inReplyTo: args.inReplyTo,
      references: args.references,
    });
    return true;
  } catch (err) {
    console.error("[mailer] send failed:", err);
    return false;
  }
}
