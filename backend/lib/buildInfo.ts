
// ═══════════════════════════════════════════════════════════════════════════
// 🏗️ BUILD IDENTIFICATION
// ═══════════════════════════════════════════════════════════════════════════
// This file serves as the Single Source of Truth for which code is running.
// It is imported by both the API (health check, errors) and the Frontend.

export const BUILD_TIMESTAMP = new Date().toISOString();
export const BUILD_VERSION = "v1.2.1-FIXED-REVERT"; 
export const BUILD_COMMIT = process.env.VERCEL_GIT_COMMIT_SHA || "local-dev";
export const BUILD_ENV = process.env.VERCEL_ENV || process.env.NODE_ENV || "development";

export const BUILD_ID = `${BUILD_VERSION}_${BUILD_COMMIT.substring(0, 7)}_${BUILD_TIMESTAMP}`;

export function getBuildInfo() {
  return {
    version: BUILD_VERSION,
    commit: BUILD_COMMIT,
    env: BUILD_ENV,
    timestamp: BUILD_TIMESTAMP,
    id: BUILD_ID
  };
}
