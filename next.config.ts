import type { NextConfig } from "next";

// B2B-зона agents.tihiydom.com. Решение по разделению B2C/B2B — вариант B (поддомен).
// SEO: индексировать НЕ нужно — глобальный noindex через заголовок + public/robots.txt.
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
