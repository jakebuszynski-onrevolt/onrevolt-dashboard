'use client'
/*!
  _   _  ___  ____  ___ ________  _   _   _   _ ___   ____  ____   ___  
 | | | |/ _ \|  _ \|_ _|__  / _ \| \ | | | | | |_ _| |  _ \|  _ \ / _ \ 
 | |_| | | | | |_) || |  / / | | |  \| | | | | || |  | |_) | |_) | | | |
 |  _  | |_| |  _ < | | / /| |_| | |\  | | |_| || |  |  __/|  _ <| |_| |
 |_| |_|\___/|_| \_\___/____\___/|_| \_|  \___/|___| |_|   |_| \_\\___/ 
                                                                                                                                                                                                                                                                                                                                       
=========================================================
* Horizon UI Dashboard PRO - v1.0.0
=========================================================

* Product Page: https://www.horizon-ui.com/pro/
* Copyright 2022 Horizon UI (https://www.horizon-ui.com/)

* Designed and Coded by Simmmple

=========================================================

* The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

*/

// Chakra imports
import { Flex } from '@chakra-ui/react';
import { useEffect, useState } from 'react';
import Card from 'components/card/Card';
import { getDeals, getCustomDealFields } from 'clients/pipedrive/pipedrive';
import SearchTableUsers from 'components/admin/main/users/users-overview/SearchTableUsersOverivew';
import tableDataUsersOverview from 'variables/users/users-overview/tableDataUsersOverview';

export default function UsersOverview() {
  const [deals, setDeals] = useState([]);
  const [users, setUsers] = useState([]);
  const [customDealFields, setCustomDealFields] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [dealsData, customFieldsData] = await Promise.all([
          getDeals(),
          getCustomDealFields()
        ]);
        // Parse dealsData and create users array according to the tableDataUsersOverview structure
        // Structure: { name: [fullName, avatarUrl], email, username, date, type, actions }
        const usersFromDeals = (dealsData || []).map(deal => {
          // Try to get name, email, username, date, type from deal fields
          // Fallbacks if not present
          const fullName = deal.person_name || 'Unknown User';
          // Try to get avatar from person or owner, fallback to a placeholder
          const avatarUrl = 'https://i.ibb.co/7p0d1Cd/Frame-24.png';
          const email =
            (deal.person_id && Array.isArray(deal.person_id.email) && deal.person_id.email[0].value) ||
            'unknown@email.com';
          const username =
            deal.owner_name ||
            '@unknownuser';
          // Use add_time or update_time as date, fallback to empty string
          const dateRaw = deal.add_time || deal.update_time || '';
          // Format date as 'MMM DD, YYYY'
          let date = '';
          if (dateRaw) {
            const d = new Date(dateRaw);
            if (!isNaN(d.getTime())) {
              date = d.toLocaleString('en-US', {
                month: 'short',
                day: '2-digit',
                year: 'numeric'
              });
            }
          }
          // Use a custom field or fallback for type
          const type =
            deal.channel_id ||
            'Member';
          return {
            name: [fullName, avatarUrl],
            email,
            username,
            date,
            type,
            actions: 'Actions'
          };
        });
        setUsers(usersFromDeals);


        setDeals(dealsData || []);
        setCustomDealFields(customFieldsData || []);
      } catch (error) {
        console.error('Error loading Pipedrive data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  return (
    <Flex direction="column" pt={{ sm: '125px', lg: '75px' }}>
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
