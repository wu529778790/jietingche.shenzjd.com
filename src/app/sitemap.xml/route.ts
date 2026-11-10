import { listAreaRoutes, listCityStats, listParkRoutes } from "@/lib/seoRepo";
import { SITE_URL, absoluteUrl, cityPath, districtPath, parkPath } from "@/lib/seo";

/**
 * 全站 sitemap（运行时生成，构建期不需要数据库）。
 *
 * 收录范围：首页 + 城市页 + 区域页 + 有在售套餐的车场页。
 * 9 千多条 URL 一个文件放得下（上限 5 万条 / 50MB），不必拆 index。
 * 进程内缓存半小时，避免爬虫高频翻页时反复打库。
 */

interface Entry {
  loc: string;
  lastmod?: string;
  changefreq?: "daily" | "weekly" | "monthly";
  priority?: string;
}

const TTL = 30 * 60 * 1000;
let cache: { at: number; xml: string } | null = null;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toXml(entries: Entry[]): string {
  const body = entries
    .map((entry) => {
      const parts = [`<loc>${escapeXml(entry.loc)}</loc>`];
      if (entry.lastmod) parts.push(`<lastmod>${entry.lastmod}</lastmod>`);
      if (entry.changefreq) parts.push(`<changefreq>${entry.changefreq}</changefreq>`);
      if (entry.priority) parts.push(`<priority>${entry.priority}</priority>`);
      return `<url>${parts.join("")}</url>`;
    })
    .join("\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`
  );
}

function isoDate(ms: number): string {
  const date = new Date(ms || Date.now());
  return date.toISOString().slice(0, 10);
}

export async function GET() {
  if (cache && Date.now() - cache.at < TTL) {
    return new Response(cache.xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=1800",
      },
    });
  }

  try {
    const [cities, areas, parks] = await Promise.all([
      listCityStats(200),
      listAreaRoutes(),
      listParkRoutes(),
    ]);

    const entries: Entry[] = [
      { loc: absoluteUrl("/"), changefreq: "daily", priority: "1.0" },
      ...cities.map((city) => ({
        loc: absoluteUrl(cityPath(city.city)),
        changefreq: "weekly" as const,
        priority: "0.9",
      })),
      ...areas.map((area) => ({
        loc: absoluteUrl(districtPath(area.city, area.district)),
        changefreq: "weekly" as const,
        priority: "0.7",
      })),
      ...parks.map((park) => ({
        loc: absoluteUrl(parkPath(park.code)),
        lastmod: isoDate(park.updatedAt),
        changefreq: "weekly" as const,
        priority: "0.8",
      })),
    ];

    const xml = toXml(entries);
    cache = { at: Date.now(), xml };
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=1800",
      },
    });
  } catch (error) {
    console.error("sitemap 生成失败", error);
    // 库挂了也别让爬虫拿到 500：先给首页，下一轮再补
    const xml = toXml([{ loc: SITE_URL, changefreq: "daily", priority: "1.0" }]);
    return new Response(xml, {
      headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}
