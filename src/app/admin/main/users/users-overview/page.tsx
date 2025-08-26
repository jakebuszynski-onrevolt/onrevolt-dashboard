"use client";

/*!
  Horizon UI Dashboard PRO - Users Overview
*/

import { Flex } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import Link from "next/link";

import Card from "components/card/Card";
import {
  getDeals,
  getCustomDealFields,
} from "clients/pipedrive/pipedrive";
import SearchTableUsers from "components/admin/main/users/users-overview/SearchTableUsersOverivew";

export default function UsersOverview() {
  const [deals, setDeals] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [customDealFields, setCustomDealFields] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);

        const [dealsData, customFieldsData] = await Promise.all([
          getDeals(),
          getCustomDealFields(),
        ]);

        const usersFromDeals = (dealsData || []).map((deal: any) => {
          // nazwa osoby
          const fullName: string =
            deal?.person_name ||
            deal?.person_id?.name ||
            "Unknown User";
          const [firstName, ...rest] = (fullName || "").split(" ");
          const lastName = rest.join(" ");

          // avatar
          const avatarUrl =
            "https://i.ibb.co/7p0d1Cd/Frame-24.png";

          // email
          const email: string =
            (deal?.person_id &&
              Array.isArray(deal.person_id.email) &&
              deal.person_id.email[0]?.value) ||
            "";

          // nazwa właściciela
          const username: string = deal?.owner_name || "@unknownuser";

          // data
          const dateRaw: string =
            deal?.add_time || deal?.update_time || "";
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

          // typ
          const type: string = deal?.channel_id || "Member";

          // id osoby z Pipedrive
          const personId =
            deal?.person_id?.value ??
            deal?.person_id?.id ??
            (typeof deal?.person_id === "number"
              ? deal.person_id
              : "") ??
            "";

          // firma (opcjonalnie)
          const company: string =
            deal?.org_name ||
            deal?.organization?.name ||
            "";

          // URL do edycji (strona z Typeform embed)
          const params = new URLSearchParams({
            first_name: firstName || "",
            last_name: lastName || "",
            email: email || "",
            user_id: String(personId || ""),
            deal_id: String(deal?.id || ""),
            ...(company ? { company } : {}),
          }).toString();

          const editHref = `/admin/main/users/edit-user?${params}`;

          return {
            name: [fullName, avatarUrl],
            email,
            username,
            date,
            type,
            editHref, // <-- używane przez tabelę do przycisku Edit user
          };
        });

        setUsers(usersFromDeals);
        setDeals(dealsData || []);
        setCustomDealFields(customFieldsData || []);
      } catch (error) {
        console.error("Error loading Pipedrive data:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  return (
    <Flex direction="column" pt={{ sm: "125px", lg: "75px" }}>
      {loading && (
        <Card px="20px" py="20px" mt="20px">
          <div>Loading Pipedrive data...</div>
        </Card>
      )}

      {users && users.length > 0 && (
        <Card px="0px">
          <SearchTableUsers tableData={users} />
        </Card>
      )}

      {deals && deals.length > 0 && (
        <Card px="20px" py="20px" mt="20px">
          <h3>Pipedrive Deals ({deals.length})</h3>
          <pre>{JSON.stringify(deals.slice(0, 3), null, 2)}</pre>
        </Card>
      )}

      {customDealFields && customDealFields.length > 0 && (
        <Card px="20px" py="20px" mt="20px">
          <h3>Custom Deal Fields ({customDealFields.length})</h3>
          <pre>{JSON.stringify(customDealFields.slice(0, 3), null, 2)}</pre>
        </Card>
      )}
    </Flex>
  );
}
