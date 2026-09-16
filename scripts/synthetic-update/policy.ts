export type SyntheticBootstrapAction = "install-old" | "recovery-install";

/**
 * The initial acceptance bootstrap is deliberately pinned to 1.0.0. Recovery,
 * however, must be able to reinstall the exact retained prior package at any
 * later accepted version (for example 1.1.0 before 1.2/1.3 failure probes).
 */
export function bootstrapVersionAllowed(action: SyntheticBootstrapAction, version: string): boolean {
  return action === "recovery-install" || version === "1.0.0";
}
