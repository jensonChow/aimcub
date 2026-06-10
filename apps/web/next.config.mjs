/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Shared packages export their TS source directly and are transpiled by Next (internal-packages-export-source pattern).
  transpilePackages: ["@core/domain", "@core/types", "@core/api-client", "@core/llm", "@ui/tokens"],
  webpack: (config) => {
    // The shared packages use NodeNext-style `.js` extensions in their TS imports;
    // map them back to `.ts` so webpack can resolve the transpiled-from-source modules.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
