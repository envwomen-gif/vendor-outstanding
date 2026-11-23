import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The upload limit of the app is 5 MB (MAX_UPLOAD_BYTES). The default limit of an action is 1 MB.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};
export default config;
