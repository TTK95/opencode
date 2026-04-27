declare global {
  const OPENCODE_VERSION: string
  const OPENCODE_CHANNEL: string
  const OPENCODE_REPO: string
}

export const InstallationVersion = typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"
export const InstallationChannel = typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : "local"
export const InstallationRepo = typeof OPENCODE_REPO === "string" ? OPENCODE_REPO : "anomalyco/opencode"
export const InstallationLocal = InstallationChannel === "local"
