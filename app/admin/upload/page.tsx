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
  const [status, setStatus] = useState<Status>({ type: "idle" });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setStatus({ type: "error", message: "กรุณาเลือกไฟล์ PDF ก่อน" });
      return;
    }

    setStatus({ type: "loading" });

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
        setStatus({ type: "error", message: data.error ?? "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง" });
        return;
      }

      setStatus({ type: "success", message: data.message });
      setFile(null);
    } catch {
      setStatus({ type: "error", message: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ ลองใหม่อีกครั้ง" });
    }
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 480, margin: "0 auto" }}>
      <h1>อัปโหลดระเบียบเข้าฐานความรู้บอท</h1>
      <p style={{ color: "#555" }}>
        รองรับเฉพาะไฟล์ PDF — บอทจะดึงเนื้อหาที่เกี่ยวข้องมาใช้ตอบคำถามให้อัตโนมัติ
        (ต้องตั้งค่า GEMINI_FILE_SEARCH_STORE ไว้แล้ว)
      </p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "1.5rem" }}>
        <label>
          รหัสผ่าน
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ display: "block", width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
          />
        </label>

        <label>
          ไฟล์ PDF
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
            style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
          />
        </label>

        <button
          type="submit"
          disabled={status.type === "loading"}
          style={{
            padding: "0.6rem 1rem",
            background: "#06c755",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: status.type === "loading" ? "not-allowed" : "pointer",
          }}
        >
          {status.type === "loading" ? "กำลังอัปโหลด..." : "อัปโหลด"}
        </button>
      </form>

      {status.type === "success" && (
        <p style={{ marginTop: "1rem", color: "#0a7d32" }}>{status.message}</p>
      )}
      {status.type === "error" && (
        <p style={{ marginTop: "1rem", color: "#c0392b" }}>{status.message}</p>
      )}
    </main>
  );
}
