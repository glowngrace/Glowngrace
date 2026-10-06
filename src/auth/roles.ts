/**
 * The roles a Glow & Grace account can hold.
 *
 * Dependency free on purpose: the browser bundle and the server both import it,
 * the same way the shared credential constant used to be shared, so a role can
 * never mean one thing in a form and another in the database.
 *
 * `admin_users.role` is a VARCHAR with no CHECK constraint, so the database
 * stores any of these names; the enum below is where the list is enforced.
 */

/** Roles that belong to the back office. Only these can open the console. */
export const consoleRoles = [
  'Super Admin',
  'Store Administrator',
  'Store Manager',
  'Inventory Manager',
  'Partnerships Lead',
  'Content & Reviews',
  'Placement Coordinator',
] as const;

/** Roles a visitor chooses for themselves on the public registration form. */
export const portalRoles = ['Customer', 'Candidate', 'Partner Salon'] as const;

/**
 * Every role the registration form accepts.
 *
 * Deliberately the portal roles only. A back-office role is a grant, not a
 * request: anybody can type an address into a public form, so offering "Super
 * Admin" there would only fill the approval queue with claims to it. Staff
 * accounts are created and promoted from the console, where the change is
 * somebody's deliberate act.
 */
export const signupRoles = portalRoles;

export type ConsoleRole = (typeof consoleRoles)[number];
export type PortalRole = (typeof portalRoles)[number];
export type AccountRole = (typeof signupRoles)[number];

/**
 * The role that owns the deployment, and the one address it is reached at.
 *
 * The address was `glownglancebiz@gmail.com` until this branch, which is a
 * misspelling of the real one and matched no account in any database: the seed
 * looked for a row that was not there and the owner could not sign in. It is
 * spelled correctly here, and no migration can rename a row any more because there
 * are no rows to rename: every deployment starts from the seeds in the store.
 */
export const superAdminRole = 'Super Admin';
export const superAdminEmail = 'glowngracebiz@gmail.com';

/**
 * The address the owner account used to be reached at.
 *
 * Kept only so the migration and the tests can talk about the old value. Nothing
 * authenticates against it, and it must never be treated as a second owner: two
 * addresses for one account is how a deployment ends up with a way in that
 * nobody replaces.
 */
export const retiredSuperAdminEmail = 'glownglancebiz@gmail.com';

/** One line of help per role, so the form explains itself instead of a list. */
export const roleDescriptions: Record<ConsoleRole | PortalRole, string> = {
  'Super Admin': 'Everything, including the owner account',
  'Store Administrator': 'Full access to the beauty house console',
  'Store Manager': 'Orders, catalogue and day-to-day operations',
  'Inventory Manager': 'Stock levels, suppliers and product records',
  'Partnerships Lead': 'Partner salons, placements and careers',
  'Content & Reviews': 'Pages, reviews and editorial content',
  'Placement Coordinator': 'Candidates, interviews and training',
  Customer: 'Shop the collection and keep your wishlist',
  Candidate: 'Apply for roles and track your training',
  'Partner Salon': 'Post vacancies and order at wholesale prices',
};

/** Where each portal role belongs once it has been approved and signed in. */
const portalDestinations: Record<PortalRole, string> = {
  Customer: '/shop',
  Candidate: '/candidate',
  'Partner Salon': '/partner',
};

export function isConsoleRole(role: string | null | undefined): role is ConsoleRole {
  return typeof role === 'string' && (consoleRoles as readonly string[]).includes(role);
}

export function isPortalRole(role: string | null | undefined): role is PortalRole {
  return typeof role === 'string' && (portalRoles as readonly string[]).includes(role);
}

/** The page a role lands on after signing in. Anything unrecognised goes home. */
export function destinationForRole(role: string | null | undefined) {
  return isPortalRole(role) ? portalDestinations[role] : '/admin';
}