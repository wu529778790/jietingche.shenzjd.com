/** 后台专用类型：投放台账 / 对账快照。前台 bundle 不应该引到这个模块。 */

export interface OutreachLog {
  id: string;
  parkId: string;
  packageId: string;
  channel: string;
  channelDetail: string;
  content: string;
  createdAt: number;
}

/** 台账列表带出的展示字段，避免后台为了拿名字再拉一次车场库 */
export interface OutreachLogRow extends OutreachLog {
  parkName: string;
  packageName: string;
}

export interface StatSnapshot {
  id: string;
  parkId: string;
  packageId: string;
  statDate: string;
  views: number;
  orders: number;
  /** 已结佣金，单位：分 */
  commission: number;
  createdAt: number;
}
