/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the Hono worker serves the generated HTML at "/" and the assets from /static/landing.
  output: 'export',
  assetPrefix: '/static/landing',
  images: { unoptimized: true },
  reactStrictMode: false, // the scroll-motion engine mutates the DOM imperatively; avoid double-mount in dev
  trailingSlash: false,
}
export default nextConfig
