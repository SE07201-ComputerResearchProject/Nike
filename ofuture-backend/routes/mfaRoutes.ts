// routes/mfaRoutes.ts
// ─────────────────────────────────────────────
// MFA routes.
// ─────────────────────────────────────────────

import express from 'express';

const {
  setup, 
  confirmSetup, 
  verifyMfa,
  getStatus, 
  disable, 
  regenerateBackupCodes,
} = require('../controllers/mfaController');

const { authenticate } = require('../middleware/auth');
const { noCache, autobanCheck } = require('../middleware/security');
const { authLimiters } = require('../middleware/rateLimiter');
const {
  validateMfaCode,
  validateMfaVerify,
  validateMfaDisable,
} = require('../middleware/validate');

const router = express.Router();

// ─────────────────────────────────────────────
// PUBLIC — mfaToken only (NOT a full session JWT)
// ─────────────────────────────────────────────

router.post('/verify', authLimiters.mfa, noCache, autobanCheck, validateMfaVerify, verifyMfa);

// ─────────────────────────────────────────────
// AUTHENTICATED — full JWT required
// ─────────────────────────────────────────────

router.get('/status', authenticate, getStatus);

router.post('/setup', authenticate, authLimiters.mfa, setup);

router.post('/confirm', authenticate, authLimiters.mfa, noCache, validateMfaCode, confirmSetup);

router.post('/disable', authenticate, authLimiters.mfa, noCache, autobanCheck, validateMfaDisable, disable);

router.post('/backup-codes/regenerate', authenticate, authLimiters.mfa, noCache, validateMfaCode, regenerateBackupCodes);

export = router;