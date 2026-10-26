/**
 * The module id. DESIGN.md calls it `MOD`: it is the flag scope, the settings namespace, the prefix of
 * every i18n key, and the prefix of the module's hooks and queries. i18n keys are written out in full
 * as string literals, never built from this constant, so that `npm run lint` can check each one exists;
 * their first segment is capitalised (Queue.Title), and hook and query names are lower case.
 */
export const MODULE_ID = "pf2e-artisans-workshop";
