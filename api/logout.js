// /api/logout — Clear the session cookie.

export default function handler(req, res) {
  res.setHeader(
    'Set-Cookie',
    `rmb_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`
  );
  return res.status(200).json({ ok: true });
}
