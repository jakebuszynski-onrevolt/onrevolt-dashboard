import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPath } from "../lib/basePath"; // <- jeśli u Ciebie inaczej, popraw ścieżkę

export type Me = {
  id: number;
  firstname: string | null;
  lastname: string | null;
  email: string;
  username: string | null;
  role: number;
};

export default function useMe() {
  const router = useRouter();
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMe = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(apiPath("/api/auth/me"), {
        credentials: "include",
        cache: "no-store",
      });
      if (!r.ok) {
        setUser(null);
      } else {
        const j = (await r.json()) as Me;
        setUser(j);
      }
    } catch (e: any) {
      setError(String(e?.message || e));
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const logout = useCallback(async () => {
    try {
      await fetch(apiPath("/api/auth/logout"), { method: "POST" });
    } catch {}
    setUser(null);
    router.push("/auth/sign-in"); // Next sam doda basePath (/panel)
  }, [router]);

  return { user, loading, error, refresh: fetchMe, logout, setUser };
}
