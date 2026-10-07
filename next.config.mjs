/** @type {import('next').NextConfig} */
const nextConfig = {
  // ให้ /portal เปิด public/portal/index.html (ใช้เป็น LIFF Endpoint URL ของระบบขอเอกสาร)
  async rewrites() {
    return [{ source: "/portal", destination: "/portal/index.html" }];
  },
};

export default nextConfig;
