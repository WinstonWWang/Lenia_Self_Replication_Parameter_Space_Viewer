import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

function githubPagesBase(): string {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) return "/";
  const repositoryName = repository.split("/").at(-1);
  return repositoryName ? `/${repositoryName}/` : "/";
}

export default defineConfig({
  base: githubPagesBase(),
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
  },
});
