import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "."),
            // Mock server-only so tests can import modules guarded by it
            "server-only": path.resolve(__dirname, "lib/testing/server-only-mock.ts"),
        },
    },
    test: {
        environment: "node",
        // Agent worktrees live under .claude/ inside the repo; their tests belong to their own branches.
        exclude: [...configDefaults.exclude, ".claude/**"],
    },
});