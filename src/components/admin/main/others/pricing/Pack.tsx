'use client';

import {
  Badge,
  List,
  ListItem,
  ListIcon,
  Text,
  Button,
  useColorModeValue,
  Image,
  Flex,
  AspectRatio,
} from '@chakra-ui/react';
import Card from 'components/card/Card';
import { BsCircleFill } from 'react-icons/bs';
import React from 'react';

type Benefit = {
  bold?: React.ReactNode;
  text?: React.ReactNode;
};

type PackProps = {
  title: React.ReactNode;
  desc?: React.ReactNode;
  button?: string;
  price?: React.ReactNode;
  details?: React.ReactNode;
  /** Może być tablica stringów lub obiektów Benefit */
  benefits?: Array<string | Benefit>;
  highlighted?: boolean;
  CTA?: React.ReactNode;
  image?: string;
  statement?: React.ReactNode;
};

export default function Pack(props: PackProps) {
  const {
    title,
    desc,
    button,
    price,
    details,
    benefits = [],
    highlighted,
    CTA,
    image,
    statement,
  } = props;

  const textColor = useColorModeValue('secondaryGray.900', 'white');

  // Ujednolicenie benefits -> Benefit[]
  const normalizedBenefits: Benefit[] = benefits.map((b) =>
    typeof b === 'string' ? { text: b } : b
  );

  return (
    <Card
      p="20px"
      w={{ sm: '100%', '2sm': '100%', md: '650px', lg: '375px' }}
      alignItems="flex-start"
      justifyContent="flex-start"
      overflow="unset !important"
      pt={highlighted ? '60px' : '30px'}
    >
      <Badge
        display={highlighted ? 'block' : 'none'}
        w="max-content"
        position="absolute"
        fontSize="sm"
        color="orange.500"
        bg="orange.100"
        fontWeight="bold"
        textTransform="unset"
        left="50%"
        borderRadius="70px"
        transform="translate(-50%,-250%)"
      >
        Most popular plan
      </Badge>

      <Text fontSize="30px" color={textColor} fontWeight="700">
        {title}
      </Text>

      {desc && (
        <Text mb="20px" fontSize="md" color="secondaryGray.600" fontWeight="500">
          {desc}
        </Text>
      )}

      {statement && (
        <Text
          mb="20px"
          fontSize="1.65rem"
          color="secondaryGray.600"
          fontWeight="500"
          lineHeight="2rem"
          minH="100px"
        >
          {statement}
        </Text>
      )}

      {image && (
        <AspectRatio width="100%" ratio={357 / 234}>
          <Image src={image} alt="revolve" width="100%" height="100%" borderRadius="20px"/>
        </AspectRatio>
      )}

      {details && (
        <Text fontSize="md" color="secondaryGray.600" fontWeight="500" mt="12px">
          {details}
        </Text>
      )}

      {!!normalizedBenefits.length && (
        <List
          spacing={3}
          justifyContent="flex-start"
          flexDirection="row"
          flexWrap="wrap"
          mt="8px"
        >
          {normalizedBenefits.map((benefit, index) => (
            <ListItem
              key={index}
              display="flex"
              textAlign="start"
              fontSize="md"
              fontWeight="400"
              color={textColor}
              alignItems="flex-start"
              lineHeight="110%"
              mt="12px !important"
              maxW="100%"
            >
              <ListIcon
                w="10px"
                h="10px"
                as={BsCircleFill}
                mt="4px"
                color={textColor}
              />
              <Flex direction="column" alignItems="flex-start">
                {benefit.bold && (
                  <Text fontWeight="bold" display="inline">
                    {benefit.bold}
                  </Text>
                )}
                {benefit.text && <Text display="inline">{benefit.text}</Text>}
              </Flex>
            </ListItem>
          ))}
        </List>
      )}

      {/* (opcjonalnie) przycisk lub cena, jeśli kiedyś użyjesz */}
      {price && (
        <Text mt="16px" fontWeight="700" color={textColor}>
          {price}
        </Text>
      )}

      {/* CTA na dole karty */}
      {CTA && <Flex mt="16px">{CTA}</Flex>}
    </Card>
  );
}
