import Link from "next/link";

export interface Crumb {
  name: string;
  path?: string;
}

/** 落地页面包屑：既给用户路径，也给爬虫层级 */
export default function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="面包屑" className="text-[11px] text-muted">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, index) => (
          <li key={`${item.name}-${index}`} className="flex items-center gap-1">
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            {item.path ? (
              <Link href={item.path} className="hover:text-brand">
                {item.name}
              </Link>
            ) : (
              <span className="text-foreground">{item.name}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
