import { redirect } from "next/navigation";

/**
 * `/admin` 只是个入口，不做页面。
 *
 * 后台四个 Tab 的真实路径是 /admin/parks 那些，光敲域名 + /admin 会撞 404；
 * 这里直接转到默认页，省得每次去翻书签。（鉴权在 proxy 里，未登录先被送去登录页。）
 */
export default function AdminIndexPage(): never {
  redirect("/admin/parks");
}
