'use client';

import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Icon,
  SimpleGrid,
  Text,
  useColorModeValue,
} from '@chakra-ui/react';
import Card from 'components/card/Card';
import Link from 'next/link';
import { MdArrowForward, MdCheckCircle, MdSettings } from 'react-icons/md';

type Metric = {
  label: string;
  value: string;
  tone?: 'purple' | 'blue' | 'green' | 'orange' | 'red';
};

type CrmModulePageProps = {
  title: string;
  eyebrow: string;
  description: string;
  metrics?: Metric[];
  workflow: string[];
  endpoints: string[];
  primaryHref?: string;
  primaryLabel?: string;
};

const badgeColor: Record<NonNullable<Metric['tone']>, string> = {
  purple: 'purple',
  blue: 'blue',
  green: 'green',
  orange: 'orange',
  red: 'red',
};

export default function CrmModulePage({
  title,
  eyebrow,
  description,
  metrics = [],
  workflow,
  endpoints,
  primaryHref,
  primaryLabel,
}: CrmModulePageProps) {
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const endpointBorder = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');

  return (
    <Flex direction="column" pt={{ base: '130px', md: '80px', xl: '80px' }} gap="20px">
      <Card p={{ base: '20px', md: '28px' }}>
        <Flex direction={{ base: 'column', lg: 'row' }} gap="18px" align={{ lg: 'center' }}>
          <Box flex="1">
            <Badge colorScheme="purple" mb="12px" borderRadius="8px" px="10px" py="4px">
              {eyebrow}
            </Badge>
            <Heading as="h1" size="lg" color={textColor} mb="10px">
              {title}
            </Heading>
            <Text color={mutedColor} fontSize="md" maxW="860px">
              {description}
            </Text>
          </Box>
          {primaryHref && primaryLabel ? (
            <Button
              as={Link}
              href={primaryHref}
              colorScheme="purple"
              leftIcon={<Icon as={MdArrowForward} />}
              alignSelf={{ base: 'flex-start', lg: 'center' }}
            >
              {primaryLabel}
            </Button>
          ) : null}
        </Flex>
      </Card>

      {metrics.length ? (
        <SimpleGrid columns={{ base: 1, md: 2, xl: 4 }} gap="20px">
          {metrics.map((metric) => (
            <Card key={metric.label} p="20px">
              <Badge colorScheme={badgeColor[metric.tone || 'purple']} w="fit-content" mb="12px">
                {metric.label}
              </Badge>
              <Text color={textColor} fontSize="2xl" fontWeight="800">
                {metric.value}
              </Text>
            </Card>
          ))}
        </SimpleGrid>
      ) : null}

      <SimpleGrid columns={{ base: 1, xl: 2 }} gap="20px">
        <Card p="22px">
          <Flex align="center" gap="10px" mb="16px">
            <Icon as={MdCheckCircle} color="green.500" boxSize="22px" />
            <Text color={textColor} fontSize="lg" fontWeight="800">
              Przepływ pracy
            </Text>
          </Flex>
          <Flex direction="column" gap="12px">
            {workflow.map((item, index) => (
              <Flex key={item} gap="12px" align="flex-start">
                <Badge colorScheme="purple" borderRadius="999px" minW="30px" textAlign="center">
                  {index + 1}
                </Badge>
                <Text color={mutedColor}>{item}</Text>
              </Flex>
            ))}
          </Flex>
        </Card>

        <Card p="22px">
          <Flex align="center" gap="10px" mb="16px">
            <Icon as={MdSettings} color="brand.500" boxSize="22px" />
            <Text color={textColor} fontSize="lg" fontWeight="800">
              Interfejsy API
            </Text>
          </Flex>
          <Flex direction="column" gap="10px">
            {endpoints.map((endpoint) => (
              <Box
                key={endpoint}
                border="1px solid"
                borderColor={endpointBorder}
                borderRadius="8px"
                px="12px"
                py="10px"
              >
                <Text color={textColor} fontFamily="monospace" fontSize="sm">
                  {endpoint}
                </Text>
              </Box>
            ))}
          </Flex>
        </Card>
      </SimpleGrid>
    </Flex>
  );
}
