import "./globals.css";
import type { Metadata } from "next";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: "Shikho Leave Portal",
  description: "Leave application and management portal",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isStaging = process.env.NEXT_PUBLIC_ENV === "staging";

  return (
    <html lang="en">
      <body>
        {isStaging && (
          <div className="bg-sunrise text-white text-center text-sm font-semibold py-1.5 px-4">
            This portal is for testing purpose only. Leave activities here will not effect balance
          </div>
        )}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
