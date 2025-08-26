"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";

const FORM_ID = process.env.NEXT_PUBLIC_TYPEFORM_FORM_ID || "u1jiARSz"; // możesz zostawić z .env
const FORM_BASE =
  process.env.NEXT_PUBLIC_TYPEFORM_BASE || "https://windyone.typeform.com"; // albo "https://form.typeform.com"

export default function EditUserPage() {
  const sp = useSearchParams();

  // Zbuduj fragment #key=value&key2=value2 z wszystkich parametrów z URL-a tej strony
  const hashFragment = useMemo(() => {
    const pairs = Array.from(sp.entries())
      .filter(([, v]) => v !== null && v !== undefined && v !== "");
    if (pairs.length === 0) return "";
    const encoded = pairs
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    return `#${encoded}`;
  }, [sp]);

  const src = `${FORM_BASE}/to/${FORM_ID}${hashFragment}`;

  return (
    <div style={{ width: "100%", height: "80vh" }}>
      <iframe
        src={src}
        style={{ width: "100%", height: "100%", border: 0 }}
        allow="camera; microphone; autoplay; encrypted-media;"
        // sandbox lub referrerPolicy dodaj tylko jeśli macie ostrą CSP
      />
    </div>
  );
}
