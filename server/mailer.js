const nodemailer = require("nodemailer");
const { config } = require("./config");

async function sendMail(store, message) {
  const settings = await store.settings();
  const smtp = { ...config.smtp, ...(settings.smtp || {}) };
  const mail = {
    from: smtp.from || config.smtp.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html
  };

  if (!smtp.host || !smtp.user || !smtp.pass) {
    console.log("[mail:dry-run]", JSON.stringify(mail, null, 2));
    return { dryRun: true };
  }

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port || 587),
    secure: Boolean(smtp.secure),
    auth: { user: smtp.user, pass: smtp.pass }
  });
  return transport.sendMail(mail);
}

module.exports = { sendMail };
