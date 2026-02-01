"use client";

import { Widget } from "@typeform/embed-react";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import useMe from "@/hooks/useMe"; // albo "../hooks/useMe"

function randDigits(n: number) {
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

function makeSid(userId: number): string {
  // 3 losowe cyfry + (userId+10) w hex (2 znaki) + 3 losowe cyfry
  const head = randDigits(3);
  const hex = ((userId + 10) & 0xff).toString(16).padStart(2, "0"); // np. 1 -> 0b, 2 -> 0c
  const tail = randDigits(3);
  return `${head}${hex}${tail}`;
}

export default function TypeformNewUser() {
  const router = useRouter();
  const { user } = useMe();

  const first = (user?.firstname || "").trim();
  const last  = (user?.lastname || "").trim();
  const fallbackName = [first, last].filter(Boolean).join(" ");
  const seller = (user?.username || fallbackName || "").trim() || undefined;

  const sid = useMemo(() => {
    if (!user?.id) return undefined;
    return makeSid(user.id);
  }, [user?.id]);

  // zbuduj obiekt hidden tylko z ustawionych wartości (Typeform lubi stringi)
  const hidden: Record<string, string> = {};
  if (seller) hidden.seller = seller;
  if (sid) hidden.sid = sid;

  return (
    <div style={{ width: "100%", height: "80vh" }}>
      <Widget
        id={process.env.NEXT_PUBLIC_TYPEFORM_FORM_ID!}
        style={{ width: "100%", height: "100%" }}
        hidden={hidden}                 // => ?seller=...&sid=...
        onSubmit={() => router.push("/admin/main/users")}
      />
    </div>
  );
}
