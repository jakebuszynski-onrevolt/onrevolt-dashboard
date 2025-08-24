// Chakra imports
import { Box, Flex, Text, Badge, Icon, LightMode } from '@chakra-ui/react';
import LineChart from 'components/charts/LineChart';
import { BsArrowsAngleExpand } from 'react-icons/bs';
// Custom components
import {
  lineChartDataSidebar,
  lineChartOptionsSidebar,
} from 'variables/charts';
export default function SidebarDocs(props: {
  mini: boolean;
  hovered: boolean;
}) {
  const { mini, hovered } = props;
  return (
    <Flex
      justify="center"
      direction="column"
      align="center"
      bgGradient="linear(to-b, brand.400, brand.600)"
      borderRadius="20px"
      // me="20px"
      ms={{ base: 'auto', '2xl': '0px' }}
      me={{ base: 'auto', '2xl': '0px' }}
      position="relative"
      maxW="100%"
      w="100%"
    >
      <Icon
        display={mini === true && hovered === false ? 'block' : 'none'}
        h="26px"
        w="26px"
        my="100px"
        mx="20px"
        color="white"
        as={BsArrowsAngleExpand}
      />
      <Flex
        direction="column"
        mb="12px"
        align="center"
        justify="center"
        px="15px"
        pt="30px"
        display={
          mini === false
            ? 'block'
            : mini === true && hovered === true
            ? 'block'
            : 'none'
        }
      >
        <Text
          display={
            mini === false
              ? 'block'
              : mini === true && hovered === true
              ? 'block'
              : 'none'
          }
          fontSize={{ base: 'lg', xl: '2xl' }}
          color="white"
          fontWeight="bold"
          lineHeight="150%"
          textAlign="center"
          px="10px"
        >
          $3942.58
        </Text>
        <Text
          display={
            mini === false
              ? 'block'
              : mini === true && hovered === true
              ? 'block'
              : 'none'
          }
          fontSize="sm"
          color="white"
          px="10px"
          mb="14px"
          textAlign="center"
        >
          Total balance
        </Text>
        <Badge
          display={
            mini === false
              ? 'block'
              : mini === true && hovered === true
              ? 'block'
              : 'none'
          }
          colorScheme="green"
          color="green.500"
          size="lg"
          maxW="max-content"
          mx="auto"
          borderRadius="58px"
        >
          +2.45%
        </Badge>
        <Box
          h="160px"
          display={
            mini === false
              ? 'block'
              : mini === true && hovered === true
              ? 'block'
              : 'none'
          }
        >
          <LineChart
            chartData={lineChartDataSidebar}
            chartOptions={lineChartOptionsSidebar}
          />
        </Box>
      </Flex>
    </Flex>
  );
}
