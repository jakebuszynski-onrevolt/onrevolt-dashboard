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

type Deal = any;

export default function UsersOverview() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [customDealFields, setCustomDealFields] = useState<any[]>([]);
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

  // Helper: budowa wiersza użytkownika (z kompletnym editHref pełnym hiddenów)
  function mapDealToUserRow(deal: any) {
    const fullName: string =
      deal?.person_name || deal?.person_id?.name || "Unknown User";
    const [firstName, ...rest] = (fullName || "").split(" ");
    const lastName = rest.join(" ");

    const avatarUrl =
      "https://i.ibb.co/7p0d1Cd/Frame-24.png";

    const email: string =
      (deal?.person_id &&
        Array.isArray(deal.person_id.email) &&
        deal.person_id.email[0]?.value) ||
      "";

    const phone: string =
      (deal?.person_id &&
        Array.isArray(deal.person_id.phone) &&
        deal.person_id.phone[0]?.value) ||
      "";

    const username: string = deal?.owner_name || "@unknownuser";

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

    const type: string = deal?.channel_id || "Member";

    // Identyfikatory
    const personId =
      deal?.person_id?.value ??
      deal?.person_id?.id ??
      (typeof deal?.person_id === "number" ? deal.person_id : "") ??
      "";

    const dealOwnerId =
      (typeof deal?.user_id === "number" ? deal.user_id : deal?.user_id?.id) ??
      "";

    const orgName: string = deal?.org_name || deal?.organization?.name || "";

    // Hidden fields do Typeforma / naszego edytora – WSZYSTKO co wypełnione
    const hidden: Record<string, string> = {};
    const add = (k: string, v: any) => {
      if (v === null || v === undefined) return;
      const s = String(v).trim();
      if (!s) return;
      hidden[k] = s;
    };

    // Znane hiddeny
    add("first_name", firstName);
    add("last_name", lastName);
    add("email", email);
    add("phone_number", phone);
    add("user_id", personId);
    add("person_id", personId);
    add("deal_id", deal?.id);
    add("org_name", orgName);
    add("owner_name", deal?.owner_name);
    add("deal_owner_id", dealOwnerId);

    // Stage/Pipeline nazwy
    const st = stageById[String(deal?.stage_id)];
    const pipelineId = st?.pipeline_id;
    const pipelineName = pipelineById[String(pipelineId)]?.name;
    add("stage_id", deal?.stage_id);
    add("stage_name", st?.name);
    add("pipeline_id", pipelineId);
    add("pipeline_name", pipelineName);

    // Standardowe pola deala
    add("title", deal?.title);
    add("status", deal?.status);
    add("value", deal?.value);
    add("currency", deal?.currency);
    add("mrr", deal?.mrr);
    add("arr", deal?.arr);
    add("acv", deal?.acv);
    add("pipeline", deal?.pipeline); // jeśli istnieje jako pole
    add("label", Array.isArray(deal?.label) ? deal.label.join(",") : deal?.label);
    add("channel", deal?.channel);
    add("channel_id", deal?.channel_id);
    add("add_time", deal?.add_time);
    add("update_time", deal?.update_time);
    add("expected_close_date", deal?.expected_close_date);
    add("close_time", deal?.close_time);
    add("won_time", deal?.won_time);
    add("lost_time", deal?.lost_time);

    // Custom fields
    if (Array.isArray(customDealFields)) {
      for (const f of customDealFields) {
        const key = f?.key;
        if (!key) continue;
        const val = deal[key];
        if (val === null || val === undefined || val === "") continue;
        const saneName = customKeyToName[key] || toSnake(key);
        if (Array.isArray(val)) {
          add(saneName, val.join(","));
        } else if (typeof val === "object") {
          const label = (val as any)?.label;
          add(saneName, label ?? JSON.stringify(val));
        } else {
          add(saneName, val);
        }
      }
    }

    const params = new URLSearchParams(hidden).toString();

    // ⬇️ JEDYNA ZMIANA: kierujemy do nowego edytora „native”
    const editHref = `/admin/main/users/edit-user-native?${params}`;

    return {
      name: [fullName, avatarUrl],
      email,
      username,
      date,
      type,
      editHref,
      // do ewentualnych debugów:
      _stage_id: deal?.stage_id,
      _pipeline_id: pipelineId ?? deal?.pipeline_id ?? deal?.pipeline,
    };
  }

  // Filtruj DEALE po pipeline/stage
  const filteredDeals = useMemo(() => {
    return (deals || []).filter((deal) => {
      const st = stageById[String(deal?.stage_id)];
      const pId = st?.pipeline_id;

      if (selectedPipelineId !== "all" && String(pId) !== selectedPipelineId)
        return false;
      if (selectedStageId !== "all" && String(deal?.stage_id) !== selectedStageId)
        return false;

      return true;
    });
  }, [deals, stageById, selectedPipelineId, selectedStageId]);

  // Wiersze użytkowników po filtrach
  const filteredUsers = useMemo(
    () => filteredDeals.map((d) => mapDealToUserRow(d)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            getStages(), // wszystkie stage z wszystkich pipeline'ów
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
            Widoczne deale: <b>{filteredDeals.length}</b> /{" "}
            <b>{deals.length}</b>
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
        <pre>{JSON.stringify(stages.slice(0, 3), null, 2)}</pre>
      </Card>
      */}
    </Flex>
  );
}
