/** 时间工具：北京时间口径，客户端与服务端共用（无任何 node 依赖） */

/** 当前北京时间 HH:mm（竞价窗口判断、日志记录、前端按钮门槛共用同一口径） */
export function beijingHM(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(11, 16);
}

/** 竞价买入窗口：09:25 竞价结束 ~ 09:35 开盘回踩确认 */
export function inAuctionWindow(hm: string = beijingHM()): boolean {
  return hm >= "09:25" && hm <= "09:35";
}
