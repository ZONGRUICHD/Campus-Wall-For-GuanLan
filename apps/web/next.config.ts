import type { NextConfig } from "next";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const githubPagesBasePath =
  process.env.GITHUB_ACTIONS === "true" && repositoryName
    ? `/${repositoryName}`
    : "";
const configuredBasePath =
  process.env.NEXT_PUBLIC_BASE_PATH ?? githubPagesBasePath;
const basePath =
  configuredBasePath === "/" ? "" : configuredBasePath.replace(/\/$/, "");

const nextConfig: NextConfig = {
  // GitHub Pages only serves static assets; all dynamic data is fetched from
  // the separately deployed FastAPI service in client components.
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: basePath || undefined,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
