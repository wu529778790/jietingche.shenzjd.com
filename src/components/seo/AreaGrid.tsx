import Link from "next/link";

export interface AreaLink {
  name: string;
  href: string;
  count?: number;
}

/** 区域/城市链接块：横向 chip，给爬虫铺「城市 → 区域」的第二层路径 */
export default function AreaGrid({ items }: { items: AreaLink[] }) {
  if (!items.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-foreground transition-colors hover:border-brand/50 hover:text-brand"
          >
            {item.name}
            {item.count ? <span className="text-[10px] text-muted">{item.count}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
