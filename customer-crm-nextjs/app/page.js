"use client";

import { useState } from "react";
import Script from "next/script";
import bodyMarkup from "./bodyMarkup";

/**
 * This page renders the original CRM app markup/CSS verbatim, then loads 3
 * scripts client-side, IN ORDER, since each depends on the previous:
 *
 *   1. xlsx.full.min.js — needed by the Excel export buttons in app.js
 *   2. api.js           — defines window.CrmApi, the fetch() wrapper that
 *                          talks to the NestJS backend (see /legacy/api.js)
 *   3. app.js            — the original app logic, now calling CrmApi.* for
 *                          every read/write instead of only using in-memory
 *                          arrays (see /legacy/app.js)
 *
 * The backend base URL is injected as a global BEFORE api.js runs, read from
 * the NEXT_PUBLIC_API_BASE_URL env var (see .env.local.example).
 */
export default function Page() {
  const [xlsxReady, setXlsxReady] = useState(false);
  const [apiReady, setApiReady] = useState(false);

  const rawApiBase = (
    process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001/api"
  )
    .trim()
    .replace(/\/$/, "");
  const apiBase = rawApiBase.endsWith("/api")
    ? rawApiBase
    : `${rawApiBase}/api`;

  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: bodyMarkup }} />

      {/* Đặt window.__API_BASE__ TRƯỚC khi api.js chạy, để api.js đọc được. */}
      <Script id="api-base-config" strategy="beforeInteractive">
        {`window.__API_BASE__ = ${JSON.stringify(apiBase)};`}
      </Script>

      {/* Cùng bản xlsx mà trang gốc tải từ CDN, giờ tự host tại chỗ. */}
      <Script
        src="/legacy/xlsx.full.min.js"
        strategy="afterInteractive"
        onLoad={() => setXlsxReady(true)}
      />

      {/* Lớp gọi API tới backend NestJS — PHẢI nạp trước app.js vì app.js dùng window.CrmApi */}
      <Script
        src="/legacy/api.js"
        strategy="afterInteractive"
        onLoad={() => setApiReady(true)}
      />

      {/* Logic chính của app — chỉ chạy khi cả xlsx lẫn api.js đã sẵn sàng */}
      {xlsxReady && apiReady && (
        <Script src="/legacy/app.js" strategy="afterInteractive" />
      )}
    </>
  );
}
