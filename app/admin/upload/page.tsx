"use client";

import { useState, FormEvent } from "react";

type Status =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "success"; message: string }
  | { type: "error"; message: string };

type DocItem = {
  name: string;
  displayName: string;
  sizeBytes: number;
  state: string;
  createTime: string;
};

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatState(state: string): string {
  if (state.includes("ACTIVE")) return "พร้อมใช้งาน";
  if (state.includes("PENDING")) return "กำลังทำ index";
  if (state.includes("FAILED")) return "ล้มเหลว";
  return state || "-";
}

function formatDate(iso: string): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" });
}

export default function UploadPage() {
  const [password, setPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [setupStatus, setSetupStatus] = useState<Status>({ type: "idle" });
  const [uploadStatus, setUploadStatus] = useState<Status>({ type: "idle" });
  const [docs, setDocs] = useState<DocItem[] | null>(null);
  const [docsStatus, setDocsStatus] = useState<Status>({ type: "idle" });

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

  async function loadDocs() {
    if (!password) {
      setDocsStatus({ type: "error", message: "กรอกรหัสผ่านก่อน" });
      return;
    }
    setDocsStatus({ type: "loading" });
    try {
      const res = await fetch("/api/admin/list-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDocsStatus({ type: "error", message: data.error ?? "เกิดข้อผิดพลาด" });
        return;
      }
      setDocs(data.docs);
      setDocsStatus({ type: "idle" });
    } catch {
      setDocsStatus({ type: "error", message: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" });
    }
  }

  async function handleDelete(doc: DocItem) {
    if (!window.confirm(`ลบ "${doc.displayName}" ออกจากฐานความรู้บอท?\nลบแล้วกู้คืนไม่ได้ ต้องอัปโหลดใหม่`)) return;
    setDocsStatus({ type: "loading" });
    try {
      const res = await fetch("/api/admin/delete-doc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: password, name: doc.name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDocsStatus({ type: "error", message: data.error ?? "ลบไม่สำเร็จ" });
        return;
      }
      await loadDocs();
    } catch {
      setDocsStatus({ type: "error", message: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" });
    }
  }

  async function handleUpload(e: FormEvent, replace = false) {
    e.preventDefault();
    if (!file) {
      setUploadStatus({ type: "error", message: "กรุณาเลือกไฟล์ PDF ก่อน" });
      return;
    }

    setUploadStatus({ type: "loading" });

    const formData = new FormData();
    formData.append("secret", password);
    formData.append("file", file);
    if (replace) formData.append("replace", "true");

    try {
      const res = await fetch("/api/admin/upload-doc", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (res.status === 409 && data.duplicate) {
        // ชื่อไฟล์ซ้ำ — ถามก่อนว่าจะแทนที่ฉบับเก่าไหม
        if (window.confirm(`${data.error}\nต้องการแทนที่ฉบับเก่าด้วยไฟล์ใหม่นี้หรือไม่?`)) {
          await handleUpload(e, true);
        } else {
          setUploadStatus({ type: "idle" });
        }
        return;
      }

      if (!res.ok) {
        setUploadStatus({ type: "error", message: data.error ?? "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง" });
        return;
      }

      setUploadStatus({ type: "success", message: data.message });
      setFile(null);
      if (docs) loadDocs();
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
      <section style={{ marginTop: "1.5rem", padding: "1rem", border: "1px solid #ddd", borderRadius: 8 }}>
        <h2 style={{ fontSize: "1.05rem", marginTop: 0 }}>ขั้นตอนที่ 3: เอกสารที่อัปโหลดแล้ว</h2>
        <p style={{ color: "#555", fontSize: "0.9rem" }}>
          ดูรายการและลบเอกสารใน File Search ได้ที่นี่ (ลบแล้วกู้คืนไม่ได้) อัปโหลดไฟล์ชื่อเดิมซ้ำ ระบบจะถามว่าจะแทนที่ฉบับเก่าหรือไม่
        </p>
        <button
          type="button"
          onClick={loadDocs}
          disabled={docsStatus.type === "loading"}
          style={{
            padding: "0.6rem 1rem",
            background: "#333",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: docsStatus.type === "loading" ? "not-allowed" : "pointer",
          }}
        >
          {docsStatus.type === "loading" ? "กำลังโหลด..." : docs ? "รีเฟรชรายการ" : "โหลดรายการเอกสาร"}
        </button>
        {docsStatus.type === "error" && (
          <p style={{ marginTop: "1rem", color: "#c0392b", fontSize: "0.9rem" }}>{docsStatus.message}</p>
        )}
        {docs && (
          <div style={{ marginTop: "1rem" }}>
            <p style={{ fontSize: "0.9rem", color: "#555" }}>ทั้งหมด {docs.length} ฉบับ</p>
            {docs.length === 0 && <p style={{ fontSize: "0.9rem" }}>ยังไม่มีเอกสารใน store</p>}
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {docs.map((d) => (
                <li
                  key={d.name}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.6rem 0",
                    borderTop: "1px solid #eee",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "0.95rem", wordBreak: "break-word" }}>{d.displayName}</div>
                    <div style={{ fontSize: "0.8rem", color: "#777" }}>
                      {formatSize(d.sizeBytes)} · {formatState(d.state)} · {formatDate(d.createTime)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(d)}
                    disabled={docsStatus.type === "loading"}
                    style={{
                      padding: "0.4rem 0.8rem",
                      background: "#fff",
                      color: "#c0392b",
                      border: "1px solid #c0392b",
                      borderRadius: 6,
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    ลบ
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}
