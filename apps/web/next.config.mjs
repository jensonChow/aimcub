/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 共享包直接导出 TS 源码,由 Next 转译(internal-packages-export-source 模式)。
  transpilePackages: ["@core/domain", "@core/types", "@core/api-client", "@ui/tokens"],
};

export default nextConfig;
