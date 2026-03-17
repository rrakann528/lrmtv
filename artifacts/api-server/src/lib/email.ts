import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.hostinger.com",
  port: Number(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER || "support@lrmtv.sbs",
    pass: process.env.SMTP_PASSWORD || "",
  },
});

export async function sendOtpEmail(to: string, code: string): Promise<void> {
  const from = process.env.SMTP_FROM || "LrmTV <support@lrmtv.sbs>";

  await transporter.sendMail({
    from,
    to,
    subject: `${code} — رمز التحقق من LrmTV`,
    html: `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:Arial,sans-serif;color:#fff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#1a1a2e;border-radius:16px;overflow:hidden;border:1px solid #2a2a4a;">
        <tr><td style="background:linear-gradient(135deg,#06B6D4,#8B5CF6);padding:32px;text-align:center;">
          <h1 style="margin:0;font-size:28px;font-weight:bold;color:#fff;">LrmTV</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:14px;">منصة المشاهدة الجماعية</p>
        </td></tr>
        <tr><td style="padding:40px 32px;text-align:center;">
          <p style="margin:0 0 8px;font-size:16px;color:#a0a0b0;">رمز التحقق من بريدك الإلكتروني</p>
          <div style="background:#0f0f0f;border:2px solid #06B6D4;border-radius:12px;padding:20px;margin:24px 0;display:inline-block;">
            <span style="font-size:40px;font-weight:bold;letter-spacing:12px;color:#06B6D4;">${code}</span>
          </div>
          <p style="margin:0;font-size:14px;color:#606080;">هذا الرمز صالح لمدة <strong style="color:#fff;">10 دقائق</strong></p>
          <p style="margin:16px 0 0;font-size:13px;color:#404060;">إذا لم تطلب هذا الرمز، تجاهل هذا البريد.</p>
        </td></tr>
        <tr><td style="padding:16px 32px 24px;text-align:center;border-top:1px solid #2a2a4a;">
          <p style="margin:0;font-size:12px;color:#404060;">© 2026 LrmTV — <a href="https://lrmtv.sbs" style="color:#06B6D4;text-decoration:none;">lrmtv.sbs</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    text: `رمز التحقق الخاص بك في LrmTV هو: ${code}\n\nهذا الرمز صالح لمدة 10 دقائق.`,
  });
}
