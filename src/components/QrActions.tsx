"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

/**
 * 二维码的下一步动作。
 *
 * 为什么不是「打开链接」：这条链接在微信里点不开（`m.jparking.cn/carParkDetail`
 * 不是网页，只是「扫普通链接二维码打开小程序」的规则前缀，扫码由微信客户端本地解析）。
 * 所以只有两种走法：
 *  - 微信内：长按识别（等价于扫码）
 *  - 其它环境：下载图片 → 微信扫一扫 → 相册选图
 */

const subscribe = () => () => {};

/** 只有手机微信才支持长按识别，PC 微信走扫码分支 */
function useIsWechat(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      const ua = navigator.userAgent;
      return /MicroMessenger/i.test(ua) && /Mobile|Android|iPhone|iPad/i.test(ua);
    },
    () => false,
  );
}

function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.innerWidth < 640,
    () => false,
  );
}

function useIsIOS(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => /iPhone|iPad|iPod/i.test(navigator.userAgent),
    () => false,
  );
}

/** 二维码是 GIF，转成 PNG 再下载，微信相册识别更稳 */
async function toPng(dataUrl: string, size = 512): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  // 二维码放大用最近邻，保持像素锐利，别糊成一团
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, size, size);
  return canvas.toDataURL("image/png");
}

interface Props {
  /** 二维码 dataURL（GIF） */
  qr: string;
  /** 下载文件名，不含扩展名 */
  filename: string;
  /** 弹层里空间紧，步骤文案压短 */
  compact?: boolean;
}

export default function QrActions({ qr, filename, compact = false }: Props) {
  const inWechat = useIsWechat();
  const isIOSDevice = useIsIOS();
  const isMobile = useIsMobile();
  const [saved, setSaved] = useState(false);

  const save = useCallback(async () => {
    let href = qr;
    let ext = "gif";
    try {
      href = await toPng(qr);
      ext = "png";
    } catch {
      // 转图失败就下载原图，反正也是能扫的
    }

    const link = document.createElement("a");
    link.href = href;
    link.download = `${filename}.${ext}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setSaved(true);
  }, [qr, filename]);

  // 微信内：长按识别最顺，不用下载
  if (inWechat) {
    return (
      <p className="text-center text-xs leading-relaxed text-muted">
        长按识别上方二维码 → 直接进小程序办理
      </p>
    );
  }

  // PC 浏览器：手机直接扫屏幕上的码就行
  if (!isMobile) {
    return (
      <div className="text-center">
        <p className="text-xs text-muted">用手机微信「扫一扫」办理</p>
        <button
          type="button"
          className="btn-ghost mt-2 px-3 py-1.5 text-xs"
          onClick={save}
        >
          {saved ? "已下载" : "下载二维码（发给别人）"}
        </button>
      </div>
    );
  }

  // iPhone/iPad：download 属性不生效，点了只会打开图片预览（页面被盖住，看不到引导），
  // 直接让用户长按二维码存相册，Safari 原生支持
  if (isIOSDevice) {
    return (
      <div className="text-center">
        <p className="text-xs text-muted">长按上方二维码 →「存储到照片」</p>
        <ol className="mt-2 space-y-0.5 text-left text-[11px] leading-relaxed text-muted">
          <li>1. 打开微信 → 右上角「+」→「扫一扫」</li>
          <li>2. 点右下角「相册」，选刚才存的那张图</li>
        </ol>
      </div>
    );
  }

  // 安卓等手机浏览器：download 可用，存图后用微信扫一扫相册
  return (
    <div className="text-center">
      <button type="button" className="btn-ghost w-full py-2 text-sm" onClick={save}>
        {saved ? "已保存，去微信扫一扫" : "下载二维码"}
      </button>
      <ol className="mt-2 space-y-0.5 text-left text-[11px] leading-relaxed text-muted">
        <li>1. 点上面按钮，把二维码存到相册</li>
        <li>2. 打开微信 → 右上角「+」→「扫一扫」</li>
        <li>3. 点右下角「相册」，选这张二维码</li>
      </ol>
      {compact ? null : (
        <p className="mt-1.5 text-[11px] text-muted">在微信里打开本页，可以直接长按识别，不用下载。</p>
      )}
    </div>
  );
}
