'use client';
/*eslint-disable*/

import {
  Flex,
  List,
  ListItem,
  Text,
  useColorModeValue,
} from '@chakra-ui/react';
import Link from 'components/link/Link';

export default function Footer() {
  let textColor = useColorModeValue('gray.400', 'white');
  let linkColor = useColorModeValue({ base: 'gray.400', lg: 'white' }, 'white');
  return (
    <Flex
      zIndex="100"
      flexDirection={{
        base: 'column',
        lg: 'row',
      }}
      alignItems={{
        base: 'center',
        xl: 'start',
      }}
      justifyContent="space-between"
      px={{ base: '30px', md: '0px' }}
      pb="30px"
    >
      <Text
        color="white"
        textAlign={{
          base: 'center',
          xl: 'start',
        }}
        mb={{ base: '20px', lg: '0px' }}
      >
        {' '}
        &copy; {new Date().getFullYear()}
        <Text as="span" fontWeight="500" ms="4px" color="white">
          onRevolt Sp. z o. o. Wszelkie prawa zastrzeżone.
        </Text>
      </Text>
      <List display="flex">
        <ListItem
          me={{
            base: '20px',
            md: '44px',
          }}
        >
          <Link
            bg="none"
            _hover={{ bg: 'none' }}
            fontWeight="500"
            color="white"
            href="mailto:kontakt@onrevolt.com"
          >
            Kontakt mailowy
          </Link>
        </ListItem>
        {/* <ListItem
          me={{
            base: '20px',
            md: '44px',
          }}
        >
          <Link
            bg="none"
            _hover={{ bg: 'none' }}
            fontWeight="500"
            color={linkColor}
            href="https://www.simmmple.com/licenses"
          >
            License
          </Link>
        </ListItem>
        <ListItem
          me={{
            base: '20px',
            md: '44px',
          }}
        >
          <Link
            bg="none"
            _hover={{ bg: 'none' }}
            fontWeight="500"
            color={linkColor}
            href="https://simmmple.com/terms-of-service"
          >
            Terms of Use
          </Link>
        </ListItem>
        <ListItem>
          <Link
            bg="none"
            _hover={{ bg: 'none' }}
            fontWeight="500"
            color={linkColor}
            href="https://www.blog.simmmple.com/"
          >
            Blog
          </Link>
        </ListItem> */}
      </List>
    </Flex>
  );
}
