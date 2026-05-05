// /api/check-auth — Return 200 if the request has a valid session, 401 otherwise.

import { verifySession } from './_lib/auth.js';

export default function handler(req, res) {
  if (verifySession(req)) {
    return res.status(200).json({ authenticated: true });
  }
  return res.status(401).json({ authenticated: false });
}
