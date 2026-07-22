/**
 * Stand-in for the `server-only` package.
 *
 * That package resolves to a module that throws unless the bundler picked the
 * `react-server` condition — which is exactly what makes it useful in the app
 * and useless under `tsx`. Aliasing it to nothing lets a test import a
 * server-only module directly, which is the point: `lib/invites.ts` is
 * server-only because it touches the database and hashes passwords, not because
 * its logic needs a React runtime.
 */
export {};
