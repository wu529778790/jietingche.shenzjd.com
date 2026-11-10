"use client";

import { Option, Section } from "@/components/FilterBits";

interface Props {
  city: string;
  cities: string[];
  district: string;
  districts: string[];
  /** 城市和区域都是点完即生效，不用再确认 */
  onPickCity: (name: string) => void;
  onPickDistrict: (name: string) => void;
  onClose: () => void;
}

/** 「位置」弹层：城市 → 区域一气选完，地理位置只留这一个入口 */
export default function LocationSheet({
  city,
  cities,
  district,
  districts,
  onPickCity,
  onPickDistrict,
  onClose,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-lg flex-col rounded-t-2xl bg-card sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="text-sm font-semibold">选择位置</h2>
          <button className="text-xs text-muted" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
          <Section label="城市">
            <select
              className="field w-full"
              value={city}
              onChange={(e) => onPickCity(e.target.value)}
            >
              <option value="">全国</option>
              {cities.map((name) => (
                <option key={name} value={name}>
                  {name.replace(/市$/, "")}
                </option>
              ))}
            </select>
          </Section>

          {city && districts.length ? (
            <Section label="区域">
              <Option active={district === ""} onClick={() => onPickDistrict("")}>
                全部
              </Option>
              {districts.map((item) => (
                <Option
                  key={item}
                  active={district === item}
                  onClick={() => onPickDistrict(district === item ? "" : item)}
                >
                  {item}
                </Option>
              ))}
            </Section>
          ) : (
            <p className="mt-4 text-[11px] text-muted">先选城市，再选区域</p>
          )}
        </div>
      </div>
    </div>
  );
}
