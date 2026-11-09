import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";


const ALLOWED = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const MAX_SIZE = 8 * 1024 * 1024;

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ ok: false, error: "没有收到文件" }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) {
    return NextResponse.json({ ok: false, error: "文件为空" }, { status: 400 });
  }
  if (buffer.length > MAX_SIZE) {
    return NextResponse.json({ ok: false, error: "图片不能超过 8MB" }, { status: 413 });
  }
  const ext = (path.extname(file.name || "") || ".png").toLowerCase();
  if (!ALLOWED.includes(ext)) {
    return NextResponse.json({ ok: false, error: "只支持 png/jpg/webp/gif" }, { status: 400 });
  }
  const dir = path.join(process.cwd(), "public", "uploads");
  await mkdir(dir, { recursive: true });
  const filename = `${crypto.randomUUID()}${ext}`;
  await writeFile(path.join(dir, filename), buffer);
  return NextResponse.json({ ok: true, data: { url: `/uploads/${filename}` } });
}
