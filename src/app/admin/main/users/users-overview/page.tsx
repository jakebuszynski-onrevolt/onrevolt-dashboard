"use client";

/*!
  Horizon UI Dashboard PRO - Users Overview (z filtrami Pipeline/Stage)
*/

import { Box, Flex, HStack, Select, Text, Button } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";

import Card from "components/card/Card";
import {
  getDeals,
  getCustomDealFields,
  getPipelines,
  getStages,
} from "clients/pipedrive/pipedrive";
import SearchTableUsers from "components/admin/main/users/users-overview/SearchTableUsersOverivew";
import useMe from "hooks/useMe"; // ⬅️ pobieramy zalogowanego usera

type TableRow = {
  name: [string, string];
  email: string;
  username: string;
  date: string;
  type: string;
  editHref: string;
  editFormHref: string;
  _stage_id: any;
  _pipeline_id: any;
};

/** snake_case ASCII: usuwa diakrytyki, zamienia nie-alfanum. na _, scala, tnie, lowercase */
function toSnake(input: string, fallback = "field", maxLen = 50) {
  let s = (input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/[^A-Za-z0-9]+/g, "_");
  s = s.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  s = s.toLowerCase();
  if (!s) s = fallback;
  if (/^\d/.test(s)) s = `f_${s}`;
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

// ⬇️ helper do tel:
const formatTel = (raw?: string) => {
  const digits = String(raw ?? "").replace(/\D+/g, "");
  if (!digits) return "";
  const withCc =
    digits.startsWith("48") || digits.startsWith("0048") || digits.startsWith("+48")
      ? digits.replace(/^00/, "+")
      : `+48${digits}`;
  return `tel:${withCc.startsWith("+") ? withCc : `+${withCc}`}`;
};

type Deal = any;

export default function UsersOverview() {
  const { user: me } = useMe(); // ⬅️ mamy role i username

  const [deals, setDeals] = useState<Deal[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [customDealFields, setCustomDealFields] = useState<any[]>([]);

  const yieldFieldKey = useMemo(() => {
    const f = (customDealFields || []).find(
      (x: any) => String(x?.name || "").toLowerCase().includes("yield")
    );
    return f?.key as string | undefined;
  }, [customDealFields]);

  // ⬇️ znajdź klucz pola „seller” w custom fields Pipedrive
  const sellerFieldKey = useMemo(() => {
    const f = (customDealFields || []).find((x: any) => {
      const n = String(x?.name || "").trim().toLowerCase();
      return n === "seller" || n.includes("seller");
    });
    return f?.key as string | undefined;
  }, [customDealFields]);

  const [pipelines, setPipelines] = useState<any[]>([]);
  const [stages, setStages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Filtry
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("all");
  const [selectedStageId, setSelectedStageId] = useState<string>("all");

  // Mapy pomocnicze
  const stageById = useMemo(() => {
    const m: Record<string, any> = {};
    (stages || []).forEach((s: any) => {
      if (s?.id != null) m[String(s.id)] = s;
    });
    return m;
  }, [stages]);

  const pipelineById = useMemo(() => {
    const m: Record<string, any> = {};
    (pipelines || []).forEach((p: any) => {
      if (p?.id != null) m[String(p.id)] = p;
    });
    return m;
  }, [pipelines]);

  // Zbuduj listę stage-ów do wyboru (filtrowaną po pipeline jeśli wybrany)
  const stagesForSelect = useMemo(() => {
    const all = (stages || []) as Array<any>;
    if (selectedPipelineId === "all") return all;
    return all.filter((s) => String(s?.pipeline_id) === selectedPipelineId);
  }, [stages, selectedPipelineId]);

  // Mapa nazw custom pól: PD custom key -> sanitized snake_case name (bazuje na "name")
  const customKeyToName = useMemo(() => {
    const map: Record<string, string> = {};
    (customDealFields || []).forEach((f: any) => {
      if (f?.key) {
        map[f.key] = toSnake(f.name || f.key);
      }
    });
    return map;
  }, [customDealFields]);

  function mapDealToUserRow(deal: any): TableRow {
    const fullName: string =
      deal?.person_name || deal?.person_id?.name || "Unknown User";
    const [firstName, ...rest] = (fullName || "").split(" ");
    const lastName = rest.join(" ");

    const avatarUrl = "https://i.ibb.co/7p0d1Cd/Frame-24.png";

    const email: string =
      (deal?.person_id &&
        Array.isArray(deal.person_id.email) &&
        deal.person_id.email[0]?.value) ||
      "";

    const phoneRaw: string =
      (deal?.person_id &&
        Array.isArray(deal.person_id.phone) &&
        deal.person_id.phone[0]?.value) ||
      "";

    const phoneHref = formatTel(phoneRaw);

    const yieldValRaw = yieldFieldKey ? deal[yieldFieldKey] : undefined;
    const yieldNum =
      yieldValRaw == null || yieldValRaw === ""
        ? ""
        : String(Math.floor(Number(String(yieldValRaw).replace(",", ".")) || 0));

    const username: string = phoneHref || ""; // tymczasowo w kolumnie Owner
    const type: string = yieldNum;            // tymczasowo w kolumnie Type

    const dateRaw: string = deal?.add_time || deal?.update_time || "";
    let date = "";
    if (dateRaw) {
      const d = new Date(dateRaw);
      if (!isNaN(d.getTime())) {
        date = d.toLocaleString("en-US", {
          month: "short",
          day: "2-digit",
          year: "numeric",
        });
      }
    }

    const personId =
      deal?.person_id?.value ??
      deal?.person_id?.id ??
      (typeof deal?.person_id === "number" ? deal.person_id : "") ??
      "";

    const st = stageById[String(deal?.stage_id)];
    const pipelineId = st?.pipeline_id;

    const params = new URLSearchParams();
    if (deal?.id) params.set("deal_id", String(deal.id));
    if (personId) params.set("person_id", String(personId));

    // link do istniejącej strony z parametrami first_name/last_name/email/phone
    const formParams = new URLSearchParams();
    if (firstName) formParams.set("first_name", firstName);
    if (lastName) formParams.set("last_name", lastName);
    if (email) formParams.set("email", email);
    if (phoneRaw) formParams.set("phone_number", phoneRaw);
    const editFormHref = `/admin/main/users/edit-user?${formParams.toString()}`;

    const editHref = `/admin/main/users/user-offer?${params.toString()}`;

    return {
      name: [fullName, avatarUrl],
      email,
      username,
      date,
      type,
      editHref,
      editFormHref,
      _stage_id: deal?.stage_id,
      _pipeline_id: pipelineId ?? deal?.pipeline_id ?? deal?.pipeline,
    };
  }

  // Filtruj DEALE po pipeline/stage + widoczność wg roli/sellera
// Filtruj DEALE po pipeline/stage + widoczność wg roli/sellera/access
const filteredDeals = useMemo(() => {
  const uname = String(me?.username || "").trim().toLowerCase();
  const role = Number(me?.role ?? 0);

  // domyślnie: admin -> 2 (wszystkie), user -> 1 (tylko swoje)
  const access =
    me && (me as any).access != null
      ? Number((me as any).access)
      : role === 1
      ? 2
      : 1;

  return (deals || []).filter((deal) => {
    // filtry pipeline/stage
    const st = stageById[String(deal?.stage_id)];
    const pId = st?.pipeline_id;

    if (selectedPipelineId !== "all" && String(pId) !== selectedPipelineId)
      return false;
    if (selectedStageId !== "all" && String(deal?.stage_id) !== selectedStageId)
      return false;

    // brak zalogowanego użytkownika -> nie pokazuj nic
    if (!me) return false;

    // access=0 -> brak dostępu do deal'i
    if (access === 0) return false;

    // access=1 -> tylko swoje deale (po polu "seller")
    if (access === 1) {
      if (!sellerFieldKey || !uname) return false;

      const raw = deal?.[sellerFieldKey];
      const seller = String(
        typeof raw === "object" && raw?.label != null ? raw.label : raw ?? ""
      )
        .trim()
        .toLowerCase();

      if (seller !== uname) return false;
    }

    // access>=2 -> wszystkie deale (poza filtrami pipeline/stage)
    return true;
  });
}, [deals, stageById, selectedPipelineId, selectedStageId, me, sellerFieldKey]);

  // Wiersze użytkowników po filtrach
  const filteredUsers: TableRow[] = useMemo(
    () => filteredDeals.map((d) => mapDealToUserRow(d)),
    [filteredDeals, customDealFields, stageById, pipelineById]
  );

  // Ładowanie danych
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);

        const [dealsData, customFieldsData, pipelinesData, stagesData] =
          await Promise.all([
            getDeals(),
            getCustomDealFields(),
            getPipelines(),
            getStages(),
          ]);

        setDeals(dealsData || []);
        setCustomDealFields(customFieldsData || []);
        setPipelines(pipelinesData || []);
        setStages(stagesData || []);
      } catch (error) {
        console.error("Error loading Pipedrive data:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const clearFilters = () => {
    setSelectedPipelineId("all");
    setSelectedStageId("all");
  };

  // UI
  return (
    <Flex direction="column" pt={{ sm: "125px", lg: "75px" }}>
      {/* Pasek filtrów */}
      <Card px="20px" py="16px" mb="16px">
        <Flex gap={4} wrap="wrap" align="center">
          <HStack spacing={3}>
            <Text fontWeight="600">Pipeline</Text>
            <Select
              size="sm"
              value={selectedPipelineId}
              onChange={(e) => {
                setSelectedPipelineId(e.target.value);
                setSelectedStageId("all"); // reset stage po zmianie pipeline
              }}
              minW="220px"
            >
              <option value="all">— Wszystkie —</option>
              {pipelines.map((p: any) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </Select>
          </HStack>

          <HStack spacing={3}>
            <Text fontWeight="600">Stage</Text>
            <Select
              size="sm"
              value={selectedStageId}
              onChange={(e) => setSelectedStageId(e.target.value)}
              minW="240px"
            >
              <option value="all">— Wszystkie —</option>
              {stagesForSelect.map((s: any) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </Select>
          </HStack>

          <Button size="sm" variant="outline" onClick={clearFilters}>
            Reset
          </Button>

          <Box flex="1" />

          <Text fontSize="sm" color="gray.600">
            Widoczne deale: <b>{filteredDeals.length}</b> / <b>{deals.length}</b>
          </Text>
        </Flex>
      </Card>

      {/* Loading */}
      {loading && (
        <Card px="20px" py="20px" mt="0">
          <div>Loading Pipedrive data...</div>
        </Card>
      )}

      {/* Tabela użytkowników po filtrach */}
      {filteredUsers && filteredUsers.length > 0 && (
        <Card px="0px">
          <SearchTableUsers tableData={filteredUsers} />
        </Card>
      )}

      {/* (opcjonalnie) debug / podgląd surowych danych
      <Card px="20px" py="20px" mt="20px">
        <h3>Pipelines ({pipelines.length})</h3>
        <pre>{JSON.stringify(pipelines.slice(0, 3), null, 2)}</pre>
        <h3>Stages ({stages.length})</h3>
        <pre>{JSON.stringify(stages.length > 0 ? stages.slice(0, 3) : [], null, 2)}</pre>
      </Card>
      */}
    </Flex>
  );
}
