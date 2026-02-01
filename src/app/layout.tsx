import React, {ReactNode} from "react";
import AppWrappers from "./AppWrappers";
import { DM_Sans } from "next/font/google";

const dmSans = DM_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"], // Medium = 500
  display: "swap",
  variable: "--font-dm-sans",
});

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
      <html lang="en">
          <body id={'root'}>
              <AppWrappers>{children}</AppWrappers>
          </body>
      </html>
  );
}
