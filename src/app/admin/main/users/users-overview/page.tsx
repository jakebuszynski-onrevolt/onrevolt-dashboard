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
      <Card px="0px">
        <SearchTableUsers tableData={tableDataUsersOverview} />
      </Card>
      {loading && (
        <Card px="20px" py="20px" mt="20px">
          <div>Loading Pipedrive data...</div>
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
