// config/permissions.ts
// ─────────────────────────────────────────────
// Central permission registry for O'Future.
// All role → action → resource rules live here.
// Controllers/middleware import from this file —
// never hardcode role strings elsewhere.
// ─────────────────────────────────────────────

// ── Role constants ────────────────────────────
const ROLES = {
  BUYER  : 'buyer',
  SELLER : 'seller',
  ADMIN  : 'admin',
} as const;

// ── Action constants ──────────────────────────
const ACTIONS = {
  CREATE : 'create',
  READ   : 'read',
  UPDATE : 'update',
  DELETE : 'delete',
  LIST   : 'list',
  MANAGE : 'manage',   // superpower — implies all above
} as const;

// ── Resource constants ────────────────────────
const RESOURCES = {
  PRODUCT       : 'product',
  OWN_PRODUCT   : 'own_product',
  ORDER         : 'order',
  OWN_ORDER     : 'own_order',
  ESCROW        : 'escrow',
  REVIEW        : 'review',
  USER          : 'user',
  OWN_PROFILE   : 'own_profile',
  ADMIN_PANEL   : 'admin_panel',
  LOGS          : 'logs',
  SAMPLE        : 'sample',
  OWN_SAMPLE    : 'own_sample',
  DISPUTE       : 'dispute',
  OWN_DISPUTE   : 'own_dispute',
} as const;

// ─────────────────────────────────────────────
// PERMISSION MAP
// Format: PERMISSIONS[role][resource] = Set of allowed actions
// ─────────────────────────────────────────────
const PERMISSIONS: Record<string, Record<string, Set<string>>> = {

  // ── BUYER ─────────────────────────────────
  [ROLES.BUYER]: {
    [RESOURCES.PRODUCT]     : new Set([ACTIONS.READ, ACTIONS.LIST]),
    [RESOURCES.OWN_ORDER]   : new Set([ACTIONS.CREATE, ACTIONS.READ, ACTIONS.LIST]),
    [RESOURCES.ESCROW]      : new Set([ACTIONS.READ]),
    [RESOURCES.REVIEW]      : new Set([ACTIONS.CREATE, ACTIONS.READ, ACTIONS.LIST]),
    [RESOURCES.OWN_PROFILE] : new Set([ACTIONS.READ, ACTIONS.UPDATE]),
    [RESOURCES.OWN_SAMPLE]  : new Set([ACTIONS.CREATE, ACTIONS.READ, ACTIONS.LIST, ACTIONS.UPDATE]),
    [RESOURCES.OWN_DISPUTE] : new Set([ACTIONS.CREATE, ACTIONS.READ, ACTIONS.LIST]),
  },

  // ── SELLER ────────────────────────────────
  [ROLES.SELLER]: {
    [RESOURCES.PRODUCT]     : new Set([ACTIONS.READ, ACTIONS.LIST]),
    [RESOURCES.OWN_PRODUCT] : new Set([ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE, ACTIONS.LIST]),
    [RESOURCES.OWN_ORDER]   : new Set([ACTIONS.READ, ACTIONS.LIST, ACTIONS.UPDATE]),
    [RESOURCES.ESCROW]      : new Set([ACTIONS.READ]),
    [RESOURCES.REVIEW]      : new Set([ACTIONS.READ, ACTIONS.LIST]),
    [RESOURCES.OWN_PROFILE] : new Set([ACTIONS.READ, ACTIONS.UPDATE]),
    [RESOURCES.OWN_SAMPLE]  : new Set([ACTIONS.READ, ACTIONS.LIST, ACTIONS.UPDATE]),
    [RESOURCES.OWN_DISPUTE] : new Set([ACTIONS.READ, ACTIONS.LIST]),
  },

  // ── ADMIN ─────────────────────────────────
  // Admin implicitly has MANAGE on everything.
  // The can() helper handles this — no need to list every resource.
  [ROLES.ADMIN]: {
    [RESOURCES.PRODUCT]     : new Set([ACTIONS.MANAGE]),
    [RESOURCES.ORDER]       : new Set([ACTIONS.MANAGE]),
    [RESOURCES.ESCROW]      : new Set([ACTIONS.MANAGE]),
    [RESOURCES.REVIEW]      : new Set([ACTIONS.MANAGE]),
    [RESOURCES.USER]        : new Set([ACTIONS.MANAGE]),
    [RESOURCES.OWN_PROFILE] : new Set([ACTIONS.MANAGE]),
    [RESOURCES.ADMIN_PANEL] : new Set([ACTIONS.MANAGE]),
    [RESOURCES.LOGS]        : new Set([ACTIONS.READ, ACTIONS.LIST]),
    [RESOURCES.SAMPLE]      : new Set([ACTIONS.MANAGE]),
    [RESOURCES.DISPUTE]     : new Set([ACTIONS.MANAGE]),
  },
};

// ─────────────────────────────────────────────
// can(role, action, resource)
// Pure function — returns boolean.
// ─────────────────────────────────────────────
const can = (role: string, action: string, resource: string): boolean => {
  // Admin MANAGE shortcut
  if (role === ROLES.ADMIN) return true;

  const rolePerms = PERMISSIONS[role];
  if (!rolePerms) return false;

  const resourcePerms = rolePerms[resource];
  if (!resourcePerms) return false;

  // MANAGE grants all actions
  return resourcePerms.has(ACTIONS.MANAGE) || resourcePerms.has(action);
};

// ─────────────────────────────────────────────
// ROLE HIERARCHY
// ─────────────────────────────────────────────
const ROLE_HIERARCHY: Record<string, number> = {
  [ROLES.BUYER]  : 1,
  [ROLES.SELLER] : 2,
  [ROLES.ADMIN]  : 3,
};

/**
 * hasMinRole(userRole, minRole)
 * Returns true if userRole meets or exceeds minRole in hierarchy.
 */
const hasMinRole = (userRole: string, minRole: string): boolean => {
  return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[minRole] ?? 999);
};

export = {
  ROLES,
  ACTIONS,
  RESOURCES,
  PERMISSIONS,
  can,
  hasMinRole,
};