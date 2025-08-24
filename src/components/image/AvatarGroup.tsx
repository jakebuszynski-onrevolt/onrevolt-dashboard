import { Avatar, Box, HStack } from '@chakra-ui/react';

export default function CustomAvatarGroup({
  bidders,
  max = 3,
  ...props
}: {
  bidders: any[];
  max?: number;
  [x: string]: any;
}) {
  const displayedAvatars = bidders.slice(0, max); // Limit avatars
  const overflowCount = bidders.length - max; // Calculate overflow

  return (
    <HStack spacing="-0.75rem" {...props}>
      {' '}
      {/* Stack avatars with overlap */}
      {displayedAvatars.map((avt, key) => (
        <Avatar key={key} src={avt.src} w="28px" h="28px" />
      ))}
      {overflowCount > 0 && (
        <Box
          w="28px"
          h="28px"
          bg="gray.200"
          color="blue.500"
          display="flex"
          alignItems="center"
          justifyContent="center"
          borderRadius="full"
          fontSize="sm"
          fontWeight="bold"
          zIndex="1"
        >
          +{overflowCount}
        </Box>
      )}
    </HStack>
  );
}
