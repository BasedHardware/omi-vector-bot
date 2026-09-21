function isReady() {
  return Boolean(String(process.env.RESEND_API_KEY || '').trim() && String(process.env.EMAIL_FROM || '').trim());
}

async function sendVerificationCode(email, code, { fetchImpl } = {}) {
  if (!isReady()) return { ok: false, reason: 'unconfigured' };
  const minutes = Number(process.env.OTP_TTL_MINUTES || 10) || 10;
  const fetchFn = fetchImpl || fetch;
  const res = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [email],
      subject: 'Your Omi order lookup code',
      text: `Your verification code is ${code}. It expires in ${minutes} minutes. If you did not request this, ignore this email.`,
    }),
  });
  if (!res.ok) return { ok: false, reason: 'error' };
  return { ok: true };
}

module.exports = { isReady, sendVerificationCode };
