import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Vaultic only needs Postgres: the whole encrypted vault (secrets, bookmarks,
  // and any inlined preview images) is synced as a single ciphertext blob, so no
  // separate Object Storage bucket or Functions service is provisioned here —
  // keeps the footprint minimal on the free tier and never puts anything
  // unencrypted in a second place.
  auth: false,
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
