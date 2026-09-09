import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "lineaibot",
  description: "LINE Bot ตอบคำถาม HR — กลุ่มบริหารทรัพยากรบุคคล พก.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
