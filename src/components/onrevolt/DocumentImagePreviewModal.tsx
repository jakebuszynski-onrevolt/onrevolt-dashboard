'use client';

import {
  Box,
  Flex,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Text,
  Tooltip,
  useColorModeValue,
} from '@chakra-ui/react';
import { useState } from 'react';
import { MdClose, MdFullscreen, MdFullscreenExit, MdOpenInNew } from 'react-icons/md';

export type ImagePreviewDocument = {
  id: string;
  title?: string | null;
  fileName?: string | null;
};

type Props = {
  document: ImagePreviewDocument | null;
  isOpen: boolean;
  onClose: () => void;
};

export default function DocumentImagePreviewModal({
  document,
  isOpen,
  onClose,
}: Props) {
  const [fullWindow, setFullWindow] = useState(false);
  const headerBg = useColorModeValue('white', 'navy.800');
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');

  function close() {
    setFullWindow(false);
    onClose();
  }

  if (!document) return null;

  const fileUrl = `/api/documents/${document.id}/file`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      isCentered={!fullWindow}
      size={fullWindow ? 'full' : '6xl'}
      motionPreset="scale"
    >
      <ModalOverlay bg="blackAlpha.700" backdropFilter="blur(3px)" />
      <ModalContent
        bg={headerBg}
        borderRadius={fullWindow ? '0' : '8px'}
        m={fullWindow ? '0' : { base: '8px', md: '20px' }}
        h={fullWindow ? '100dvh' : { base: 'calc(100dvh - 16px)', md: '86dvh' }}
        maxH="100dvh"
        overflow="hidden"
      >
        <ModalHeader px={{ base: '12px', md: '18px' }} py="11px">
          <Flex align="center" justify="space-between" gap="12px">
            <Box minW="0">
              <Text color={textColor} fontSize="md" fontWeight="800" noOfLines={1}>
                {document.title || document.fileName || 'Podgląd zdjęcia'}
              </Text>
              {document.fileName && document.fileName !== document.title ? (
                <Text color={mutedColor} fontSize="xs" fontWeight="500" noOfLines={1}>
                  {document.fileName}
                </Text>
              ) : null}
            </Box>
            <Flex align="center" gap="5px" flexShrink="0">
              <Tooltip label={fullWindow ? 'Przywróć okno' : 'Pełny ekran'}>
                <IconButton
                  aria-label={fullWindow ? 'Przywróć okno podglądu' : 'Pokaż na pełnym ekranie'}
                  icon={fullWindow ? <MdFullscreenExit /> : <MdFullscreen />}
                  onClick={() => setFullWindow((value) => !value)}
                  size="sm"
                  variant="ghost"
                />
              </Tooltip>
              <Tooltip label="Otwórz osobno">
                <IconButton
                  as="a"
                  href={fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Otwórz zdjęcie osobno"
                  icon={<MdOpenInNew />}
                  size="sm"
                  variant="ghost"
                />
              </Tooltip>
              <Tooltip label="Zamknij">
                <IconButton
                  aria-label="Zamknij podgląd"
                  icon={<MdClose />}
                  onClick={close}
                  size="sm"
                  variant="ghost"
                />
              </Tooltip>
            </Flex>
          </Flex>
        </ModalHeader>
        <ModalBody
          bg="#111318"
          display="flex"
          alignItems="center"
          justifyContent="center"
          minH="0"
          p={{ base: '8px', md: '14px' }}
        >
          <Box
            as="img"
            src={fileUrl}
            alt={document.title || document.fileName || 'Zdjęcie'}
            display="block"
            w="100%"
            h="100%"
            objectFit="contain"
          />
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
