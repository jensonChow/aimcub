/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Shared packages export their TS source directly and are transpiled by Next (internal-packages-export-source pattern).
  transpilePackages: ["@core/domain", "@core/types", "@core/api-client", "@ui/tokens"],
};

export default nextConfig;
