// routes/rbacTestRoutes.ts
// ─────────────────────────────────────────────
// DEVELOPMENT-ONLY routes for testing RBAC.
// Mount ONLY in non-production environments.
// Remove or gate with NODE_ENV check before prod.
// ─────────────────────────────────────────────

import express, { Request, Response } from 'express';
const { authenticate } = require('../middleware/auth');
const {
  authorizeRoles,
  authorizePermission,
  requireMinRole,
  adminOnly,
} = require('../middleware/role');
const { ROLES, ACTIONS, RESOURCES, can } = require('../config/permissions');

const router = express.Router();

interface RbacRequest extends Request {
  user?: any;
  riskScore?: number;
  riskSignals?: string[];
}

// ─────────────────────────────────────────────
// GET /api/rbac-test/role-info
// Returns the authenticated user's role + all
// permissions they hold. Useful during development.
// ─────────────────────────────────────────────
router.get('/role-info', authenticate, (req: RbacRequest, res: Response) => {
  const { role } = req.user;

  const summary: Record<string, string[]> = {};
  for (const resource of Object.values(RESOURCES) as string[]) {
    const allowed: string[] = [];
    for (const action of Object.values(ACTIONS) as string[]) {
      if (can(role, action, resource)) allowed.push(action);
    }
    if (allowed.length) summary[resource] = allowed;
  }

  res.json({
    success : true,
    data    : {
      user        : req.user,
      role,
      riskScore   : req.riskScore ?? null,
      riskSignals : req.riskSignals ?? [],
      permissions : summary,
    },
  });
});

// ─────────────────────────────────────────────
// Specific Role Endpoints
// ─────────────────────────────────────────────

router.get(
  '/buyer-only',
  authenticate,
  authorizeRoles(ROLES.BUYER),
  (req: RbacRequest, res: Response) => res.json({ success: true, message: 'Welcome, Buyer!', user: req.user })
);

router.get(
  '/seller-only',
  authenticate,
  authorizeRoles(ROLES.SELLER),
  (req: RbacRequest, res: Response) => res.json({ success: true, message: 'Welcome, Seller!', user: req.user })
);

router.get(
  '/admin-only',
  authenticate,
  adminOnly,
  (req: RbacRequest, res: Response) => res.json({ success: true, message: 'Welcome, Admin!', user: req.user })
);

router.get(
  '/seller-or-admin',
  authenticate,
  authorizeRoles(ROLES.SELLER, ROLES.ADMIN),
  (req: RbacRequest, res: Response) => res.json({ success: true, message: 'You are a seller or admin.', role: req.user.role })
);

router.post(
  '/can-create-product',
  authenticate,
  authorizePermission(ACTIONS.CREATE, RESOURCES.OWN_PRODUCT),
  (req: RbacRequest, res: Response) => res.json({ success: true, message: 'You may create products.', role: req.user.role })
);

router.get(
  '/min-seller',
  authenticate,
  requireMinRole(ROLES.SELLER),
  (req: RbacRequest, res: Response) => res.json({ success: true, message: `Role "${req.user.role}" meets minimum seller requirement.` })
);

// ─────────────────────────────────────────────
// GET /api/rbac-test/matrix
// Public — returns the full permission matrix.
// ─────────────────────────────────────────────
router.get('/matrix', (req: Request, res: Response) => {
  const matrix: any = {};

  for (const role of Object.values(ROLES) as string[]) {
    matrix[role] = {};
    for (const resource of Object.values(RESOURCES) as string[]) {
      const allowed: string[] = [];
      for (const action of Object.values(ACTIONS) as string[]) {
        if (can(role, action, resource)) allowed.push(action);
      }
      if (allowed.length) matrix[role][resource] = allowed;
    }
  }

  res.json({
    success : true,
    message : 'Full RBAC permission matrix.',
    data    : matrix,
    roles   : Object.values(ROLES),
    actions : Object.values(ACTIONS),
    resources: Object.values(RESOURCES),
  });
});

export = router;