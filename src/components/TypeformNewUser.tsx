"use client";

import { Widget } from "@typeform/embed-react";
import { useRouter } from "next/navigation";

export default function TypeformNewUser() {
  const router = useRouter();
  return (
    <div style={{ width: "100%", height: "80vh" }}>
      <Widget
        id={process.env.NEXT_PUBLIC_TYPEFORM_FORM_ID!}
        style={{ width: "100%", height: "100%" }}
        onSubmit={() => router.push("/admin/main/users")}
      />
    </div>
  );
}
