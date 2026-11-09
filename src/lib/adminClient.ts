/** 后台页面统一走这个 fetch：登录态过期时通知后台布局跳登录页 */
export const ADMIN_UNAUTHORIZED_EVENT = "jtc:admin-unauthorized";

export async function adminFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event(ADMIN_UNAUTHORIZED_EVENT));
  }
  return res;
}
