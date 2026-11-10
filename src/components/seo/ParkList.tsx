import Link from "next/link";
import type { ParkSummary } from "@/lib/seoRepo";
import { parkPath } from "@/lib/seo";

/**
 * 城市/区域页的车场列表：每条都链到车场详情页，
 * 是爬虫从「城市 → 区域 → 车场」往下钻的主要路径。
 */
export default function ParkList({ parks }: { parks: ParkSummary[] }) {
  if (!parks.length) return null;
  return (
    <ul className="divide-y divide-border">
      {parks.map((park) => (
        <li key={park.id}>
          <Link
            href={parkPath(park.parkCode)}
            className="flex items-start gap-2 px-3 py-2.5 transition-colors hover:bg-brand/[0.03]"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{park.name}</div>
              <div className="mt-0.5 truncate text-[11px] text-muted">
                {[park.district, park.area].filter(Boolean).join(" · ")}
                {park.address ? ` · ${park.address}` : ""}
              </div>
            </div>
            <div className="shrink-0 text-right">
              {park.minMonthly > 0 ? (
                <div className="text-[13px] font-semibold text-price">
                  月均 ¥{Math.round(park.minMonthly / 100)}
                </div>
              ) : (
                <div className="text-[12px] text-muted">见码</div>
              )}
              <div className="text-[11px] text-muted">{park.packageCount} 个套餐</div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
