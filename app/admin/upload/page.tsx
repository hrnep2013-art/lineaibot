"use client";

import { useState, FormEvent } from "react";

type Status =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "success"; message: string }
  | { type: "error"; message: string };

export default function UploadPage() {
  const [password, setPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [setupStatus, setSetupStatus] = useState<Status>({ type: "idle" });
  const [uploadStatus, setUploadStatus] = useState<Status>({ type: "idle" });

  async function handleSetupStore() {
    if (!password) {
      setSetupStatus({ type: "error", message: "กรอกรหัสผ่านก่อน" });
      return;
    }
    setSetupStatus({ type: "loading" });
    try {
      const res = await fetch("/api/admin/setup-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSetupStatus({ type: "error", message: data.error ?? "เกิดข้อผิดพลาด" });
        return;
      }
      setSetupStatus({
        type: "success",
        message: `สร้าง store สำเร็จ: ${data.storeName} — เอาค่านี้ไปตั้งเป็น Environment Variable ชื่อ GEMINI_FILE_SEARCH_STORE ใน Vercel (Production) แล้ว Redeploy ก่อนอัปโหลดไฟล์ด้านล่าง`,
      });
    } catch {
      setSetupStatus({ type: "error", message: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" });
    }
  }

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setUploadStatus({ type: "error", message: "กรุณาเลือกไฟล์ PDF ก่อน" });
      return;
    }

    setUploadStatus({ type: "loading" });

    const formData = new FormData();
    formData.append("secret", password);
    formData.append("file", file);

    try {
      const res = await fetch("/api/admin/upload-doc", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        setUploadStatus({ type: "error", message: data.error ?? "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง" });
        return;
      }

      setUploadStatus({ type: "success", message: data.message });
      setFile(null);
    } catch {
      setUploadStatus({ type: "error", message: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ ลองใหม่อีกครั้ง" });
    }
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 520, margin: "0 auto" }}>
      <h1>จัดการฐานความรู้บอท (File Search)</h1>

      <label style={{ display: "block", marginTop: "1.5rem" }}>
        รหัสผ่านแอดมิน
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ display: "block", width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
        />
      </label>

      <section style={{ marginTop: "2rem", padding: "1rem", border: "1px solid #ddd", borderRadius: 8 }}>
        <h2 style={{ fontSize: "1.05rem", marginTop: 0 }}>ขั้นตอนที่ 1: สร้าง File Search store</h2>
        <p style={{ color: "#555", fontSize: "0.9rem" }}>
          ทำครั้งเดียวตอนตั้งระบบครั้งแรกเท่านั้น ถ้าเคยตั้ง GEMINI_FILE_SEARCH_STORE ไว้แล้วไม่ต้องทำซ้ำ
        </p>
        <button
          type="button"
          onClick={handleSetupStore}
          disabled={setupStatus.type === "loading"}
          style={{
            padding: "0.6rem 1rem",
            background: "#333",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: setupStatus.type === "loading" ? "not-allowed" : "pointer",
          }}
        >
          {setupStatus.type === "loading" ? "กำลังสร้าง..." : "สร้าง Store"}
        </button>
        {setupStatus.type === "success" && (
          <p style={{ marginTop: "1rem", color: "#0a7d32", fontSize: "0.9rem" }}>{setupStatus.message}</p>
        )}
        {setupStatus.type === "error" && (
          <p style={{ marginTop: "1rem", color: "#c0392b", fontSize: "0.9rem" }}>{setupStatus.message}</p>
        )}
      </section>

      <section style={{ marginTop: "1.5rem", padding: "1rem", border: "1px solid #ddd", borderRadius: 8 }}>
        <h2 style={{ fontSize: "1.05rem", marginTop: 0 }}>ขั้นตอนที่ 2: อัปโหลด PDF</h2>
        <p style={{ color: "#555", fontSize: "0.9rem" }}>
          ทำได้เรื่อยๆ ทุกครั้งที่มีระเบียบใหม่ (ต้องทำขั้นตอนที่ 1 และตั้งค่า Environment Variable ให้เรียบร้อยก่อน)
        </p>
        <form onSubmit={handleUpload} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <label>
            ไฟล์ PDF
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
            />
          </label>
          <button
            type="submit"
            disabled={uploadStatus.type === "loading"}
            style={{
              padding: "0.6rem 1rem",
              background: "#06c755",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: uploadStatus.type === "loading" ? "not-allowed" : "pointer",
            }}
          >
            {uploadStatus.type === "loading" ? "กำลังอัปโหลด..." : "อัปโหลด"}
          </button>
        </form>
        {uploadStatus.type === "success" && (
          <p style={{ marginTop: "1rem", color: "#0a7d32", fontSize: "0.9rem" }}>{uploadStatus.message}</p>
        )}
        {uploadStatus.type === "error" && (
          <p style={{ marginTop: "1rem", color: "#c0392b", fontSize: "0.9rem" }}>{uploadStatus.message}</p>
        )}
      </section>
    </main>
  );
}
