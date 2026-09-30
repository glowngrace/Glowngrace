/**
 * The one published credential this project has.
 *
 * It lives here rather than in either of the two modules that need it, because
 * the browser cannot import the server's copy: `src/server/admin/passwords.ts`
 * imports `node:crypto`, so a value import of `demoPassword` from there would
 * pull Node's crypto into the Vite bundle. `src/auth/demo-auth.ts` has the
 * mirror-image problem, being browser-only by design. A dependency-free module
 * is the only thing both sides can import, which is what keeps the sample
 * accounts, the console sign-in form and the password policy telling the same
 * story.
 */
export const demoPassword = 'demo123';
