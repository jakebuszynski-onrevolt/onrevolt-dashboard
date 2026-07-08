'use client'
// Chakra imports
import { Badge, List, ListItem, ListIcon, Text, Button, useColorModeValue, Image, Flex,AspectRatio} from '@chakra-ui/react';
// Custom components
import Card from 'components/card/Card';
// Assets
import { BsCircleFill } from 'react-icons/bs';
import { ReactNode } from 'react';

export default function Pack(props: {
	title: ReactNode;
	desc: string;
	button?: string;
	price?: JSX.Element | string;
	details?: string;
	benefits: Array<string | { bold: string; text: string }>;
	highlighted?: boolean;
	CTA?: ReactNode;
	image?: string;
	statement?: ReactNode;
}) {
	const { title, desc, button, price, details, benefits, highlighted, CTA, image, statement } = props;
	const textColor = useColorModeValue('secondaryGray.900', 'white');
	return (
        <Card
            p="20px"
            pb="20px"
            w={{ sm: '100%', "2sm": '100%', md: '650px', lg: '375px' }}
            alignItems="flex-start"
            justifyContent="flex-start"
            verticalAlign="top"
            overflow="unset !important"
            pt="10px"
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
            <Text
                mb="20px"
                fontSize="md"
                color="secondaryGray.600"
                fontWeight="500"
            >
                {desc}
            </Text>
            {/* <Button
                w="100%"
                variant={highlighted ? 'brand' : 'lightBrand'}
                mb="30px"
            >
                {button}
            </Button> */}
            <Text
                mb="20px"
                fontSize="1.65rem"
                color="secondaryGray.600"
                fontWeight="500"
                lineHeight="2rem"
                height="100px"
                verticalAlign="baseline"
            >
                {statement}
            </Text>
            <AspectRatio width={'100%'} ratio={357 / 234}>
                <Image style={{ imageRendering: 'auto' }} src={image} alt="revolve" width="100%" height="100%" borderRadius="20px"/>
            </AspectRatio>
            <Text fontSize="md" color="secondaryGray.600" fontWeight="500">
                {details}
            </Text>
            <List spacing={3} justifyContent="flex-start" flexDirection="row" flexWrap="wrap">
                {benefits.map((benefit, index) => {
                    const bold = typeof benefit === 'string' ? benefit : benefit.bold;
                    const text = typeof benefit === 'string' ? '' : benefit.text;

                    return (
                    <ListItem
                        key={index}
                        display="flex"
                        textAlign="start"
                        fontSize="md"
                        fontWeight="400"
                        color={textColor}
                        alignItems="top"
                        lineHeight="110%"
                        verticalAlign="top"
                        mt="12px !important"
                    >
                        <ListIcon
                            w="10px"
                            h="10px"
                            as={BsCircleFill}
                            mt="4px"
                            color={textColor}
                        />
                        <Flex flexDirection="column" alignItems="left">
                            <Text fontWeight="bold" display="inline">{bold}</Text>
                            <Text display="inline">{text}</Text>
                        </Flex>
                    </ListItem>
                )})}{' '}
            </List>
            {CTA}
        </Card>
        
    );
}
