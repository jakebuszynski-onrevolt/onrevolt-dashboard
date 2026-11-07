'use client';

import {
  Alert,
  AlertIcon,
  Box,
  Button,
  Flex,
  Grid,
  IconButton,
  Spinner,
  Text,
  useColorModeValue,
} from '@chakra-ui/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  MdAdd,
  MdArrowDownward,
  MdArrowLeft,
  MdArrowRight,
  MdArrowUpward,
  MdLocationOn,
  MdRemove,
} from 'react-icons/md';
import { LOCATION_MAP_IMAGE_VERSION, LocationMapProvider } from 'lib/onrevolt/location-maps';
import { panLocationMapCenter } from 'lib/onrevolt/location-map-pan';
import {
  DEFAULT_LOCATION_MAP_ZOOM,
  MAX_LOCATION_MAP_ZOOM,
  MIN_LOCATION_MAP_ZOOM,
  validateLocationMapZoom,
} from 'lib/onrevolt/location-map-zoom';

type DraggableLocationMapProps = {
  latitude: number;
  longitude: number;
  provider: LocationMapProvider;
  address: string;
  disabled?: boolean;
  onCenterChange: (center: { latitude: number; longitude: number }) => void;
};

type MapImage = {
  src: string;
  provider: LocationMapProvider;
  requestKey: string;
};

type PanOffset = { x: number; y: number };

type ActiveDrag = {
  pointerId: number;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
};

const DRAG_THRESHOLD = 3;
const BUTTON_PAN_STEP = 28;
const KEYBOARD_PAN_STEP = 18;
const WHEEL_ZOOM_DEBOUNCE_MS = 150;

function makeMapRequestKey(
  provider: LocationMapProvider,
  latitude: number,
  longitude: number,
  zoom: number,
  retry: number,
) {
  return `${provider}:${latitude}:${longitude}:${zoom}:${retry}`;
}

function responseErrorMessage(response: Response, body: string) {
  const defaultMessage = `Nie udało się pobrać obrazu mapy (HTTP ${response.status}).`;
  if (!body.trim()) return defaultMessage;

  try {
    const payload = JSON.parse(body);
    if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error;
    if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message;
  } catch {
    // A plain-text response is useful to the user too.
  }
  return body.trim();
}

function decodeImage(source: string) {
  return new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Serwer zwrócił plik, którego nie można wyświetlić jako mapy.'));
    image.src = source;
    if (typeof image.decode === 'function') {
      image.decode().then(resolve, () => reject(new Error('Serwer zwrócił plik, którego nie można wyświetlić jako mapy.')));
    }
  });
}

export default function DraggableLocationMap({
  latitude,
  longitude,
  provider,
  address,
  disabled = false,
  onCenterChange,
}: DraggableLocationMapProps) {
  const [mapImage, setMapImage] = useState<MapImage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryNumber, setRetryNumber] = useState(0);
  const [zoom, setZoom] = useState(DEFAULT_LOCATION_MAP_ZOOM);
  const [offset, setOffset] = useState<PanOffset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const activeDrag = useRef<ActiveDrag | null>(null);
  const pendingPanKey = useRef<string | null>(null);
  const zoomRef = useRef(zoom);
  const disabledRef = useRef(disabled);
  const pendingWheelZoom = useRef<number | null>(null);
  const wheelZoomTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyZoomRef = useRef<(nextZoom: number) => void>(() => undefined);
  const borderColor = useColorModeValue('gray.200', 'whiteAlpha.300');
  const controlBg = useColorModeValue('white', 'gray.700');
  const controlColor = useColorModeValue('gray.800', 'white');
  const statusBg = useColorModeValue('blackAlpha.700', 'blackAlpha.800');

  zoomRef.current = zoom;
  disabledRef.current = disabled;
  const requestKey = makeMapRequestKey(provider, latitude, longitude, zoom, retryNumber);
  const imageUrl = useMemo(() => (
    `/api/geolocation/satellite?lat=${encodeURIComponent(latitude)}&lng=${encodeURIComponent(longitude)}`
    + `&provider=${encodeURIComponent(provider)}&zoom=${zoom}&v=${LOCATION_MAP_IMAGE_VERSION}&retry=${retryNumber}`
  ), [latitude, longitude, provider, retryNumber, zoom]);
  const visibleImage = mapImage?.provider === provider
    && (mapImage.requestKey === requestKey || pendingPanKey.current === requestKey)
    ? mapImage
    : null;
  const imageMatchesCurrentRequest = mapImage?.requestKey === requestKey;
  const readyForPan = !disabled && !loading && imageMatchesCurrentRequest;

  function applyMapZoom(nextZoom: number) {
    const validatedZoom = validateLocationMapZoom(nextZoom);
    if (validatedZoom === zoomRef.current) return;
    zoomRef.current = validatedZoom;
    pendingPanKey.current = null;
    activeDrag.current = null;
    setDragging(false);
    setOffset({ x: 0, y: 0 });
    setZoom(validatedZoom);
  }

  applyZoomRef.current = applyMapZoom;

  function changeZoomBy(step: number) {
    if (wheelZoomTimer.current) {
      clearTimeout(wheelZoomTimer.current);
      wheelZoomTimer.current = null;
    }
    pendingWheelZoom.current = null;
    applyMapZoom(zoomRef.current + step);
  }

  useEffect(() => {
    const map = mapContainerRef.current;
    if (!map || disabled) return undefined;

    function handleWheel(event: WheelEvent) {
      if (disabledRef.current || event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();

      const previousZoom = pendingWheelZoom.current ?? zoomRef.current;
      const direction = Math.sign(event.deltaY);
      const nextZoom = Math.max(MIN_LOCATION_MAP_ZOOM, Math.min(MAX_LOCATION_MAP_ZOOM, previousZoom - direction));
      if (nextZoom === previousZoom) return;
      pendingWheelZoom.current = nextZoom;

      if (wheelZoomTimer.current) clearTimeout(wheelZoomTimer.current);
      wheelZoomTimer.current = setTimeout(() => {
        wheelZoomTimer.current = null;
        const targetZoom = pendingWheelZoom.current;
        pendingWheelZoom.current = null;
        if (targetZoom !== null && !disabledRef.current) applyZoomRef.current(targetZoom);
      }, WHEEL_ZOOM_DEBOUNCE_MS);
    }

    map.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      map.removeEventListener('wheel', handleWheel);
      if (wheelZoomTimer.current) {
        clearTimeout(wheelZoomTimer.current);
        wheelZoomTimer.current = null;
      }
      pendingWheelZoom.current = null;
    };
  }, [disabled]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let candidateUrl: string | null = null;

    setLoading(true);
    setError('');

    async function loadImage() {
      try {
        const response = await fetch(imageUrl, {
          signal: controller.signal,
          ...(retryNumber > 0 ? { cache: 'no-store' as RequestCache } : {}),
        });
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(responseErrorMessage(response, body));
        }

        const blob = await response.blob();
        if (cancelled) return;
        if (!blob.type.startsWith('image/')) {
          throw new Error(responseErrorMessage(response, await blob.text().catch(() => '')));
        }

        candidateUrl = URL.createObjectURL(blob);
        await decodeImage(candidateUrl);
        if (cancelled) {
          if (candidateUrl) URL.revokeObjectURL(candidateUrl);
          candidateUrl = null;
          return;
        }

        setMapImage({ src: candidateUrl, provider, requestKey });
        if (pendingPanKey.current === requestKey) pendingPanKey.current = null;
        candidateUrl = null;
        setOffset({ x: 0, y: 0 });
      } catch (reason) {
        if (candidateUrl) {
          URL.revokeObjectURL(candidateUrl);
          candidateUrl = null;
        }
        if (cancelled || controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadImage();

    return () => {
      cancelled = true;
      controller.abort();
      if (candidateUrl) {
        URL.revokeObjectURL(candidateUrl);
        candidateUrl = null;
      }
    };
  }, [imageUrl, provider, requestKey]);

  useEffect(() => {
    if (!mapImage?.src) return undefined;
    const currentSource = mapImage.src;
    return () => URL.revokeObjectURL(currentSource);
  }, [mapImage?.src]);

  function centerAfterPan(dx: number, dy: number, displayWidth: number, displayHeight: number) {
    return panLocationMapCenter(latitude, longitude, provider, dx, dy, displayWidth, displayHeight, zoom);
  }

  function commitButtonPan(dx: number, dy: number, displayWidth: number, displayHeight: number) {
    if (!readyForPan) return;
    try {
      const center = centerAfterPan(dx, dy, displayWidth, displayHeight);
      pendingPanKey.current = makeMapRequestKey(provider, center.latitude, center.longitude, zoom, retryNumber);
      setOffset((current) => ({ x: current.x + dx, y: current.y + dy }));
      onCenterChange(center);
    } catch (reason) {
      pendingPanKey.current = null;
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!readyForPan || !event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    activeDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dx: 0,
      dy: 0,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = activeDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!readyForPan) {
      activeDrag.current = null;
      setDragging(false);
      setOffset({ x: 0, y: 0 });
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    activeDrag.current = { ...drag, dx, dy };
    if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_THRESHOLD) return;
    setOffset({ x: dx, y: dy });
  }

  function finishPointerDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = activeDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (!readyForPan) {
      activeDrag.current = null;
      setDragging(false);
      setOffset({ x: 0, y: 0 });
      return;
    }

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const moved = Math.max(Math.abs(dx), Math.abs(dy)) >= DRAG_THRESHOLD;
    activeDrag.current = null;
    setDragging(false);

    if (!moved) {
      setOffset({ x: 0, y: 0 });
      return;
    }

    setOffset({ x: dx, y: dy });
    try {
      const center = centerAfterPan(dx, dy, event.currentTarget.clientWidth, event.currentTarget.clientHeight);
      pendingPanKey.current = makeMapRequestKey(provider, center.latitude, center.longitude, zoom, retryNumber);
      onCenterChange(center);
    } catch (reason) {
      pendingPanKey.current = null;
      setOffset({ x: 0, y: 0 });
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function cancelPointerDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (activeDrag.current?.pointerId !== event.pointerId) return;
    activeDrag.current = null;
    setDragging(false);
    setOffset({ x: 0, y: 0 });
  }

  function handleKeyboardPan(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const displayWidth = event.currentTarget.clientWidth;
    const displayHeight = event.currentTarget.clientHeight;
    let dx = 0;
    let dy = 0;
    if (event.key === 'ArrowLeft') dx = -KEYBOARD_PAN_STEP;
    else if (event.key === 'ArrowRight') dx = KEYBOARD_PAN_STEP;
    else if (event.key === 'ArrowUp') dy = -KEYBOARD_PAN_STEP;
    else if (event.key === 'ArrowDown') dy = KEYBOARD_PAN_STEP;
    else return;
    event.preventDefault();
    commitButtonPan(dx, dy, displayWidth, displayHeight);
  }

  const busy = loading || (!imageMatchesCurrentRequest && !error);

  return (
    <Box
      ref={mapContainerRef}
      role="group"
      aria-label={`Mapa lokalizacji ${address}`}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      w="100%"
      aspectRatio="320 / 227"
      position="relative"
      overflow="hidden"
      bg="gray.800"
      border="1px solid"
      borderColor={borderColor}
      borderRadius="6px"
      cursor={readyForPan ? (dragging ? 'grabbing' : 'grab') : 'default'}
      userSelect="none"
      sx={{ touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerDrag}
      onPointerCancel={cancelPointerDrag}
      onLostPointerCapture={cancelPointerDrag}
      onKeyDown={handleKeyboardPan}
    >
      {visibleImage ? (
        <Box
          as="img"
          src={visibleImage.src}
          alt={`Zdjęcie lokalizacji ${address} ze źródła ${provider}`}
          draggable={false}
          position="absolute"
          inset="0"
          w="100%"
          h="100%"
          objectFit="cover"
          pointerEvents="none"
          transform={`translate(${offset.x}px, ${offset.y}px)`}
          transition={dragging ? 'none' : 'transform 100ms ease-out'}
        />
      ) : null}

      <Box
        position="absolute"
        left="50%"
        top="50%"
        transform="translate(-50%, -100%)"
        color="red.500"
        filter="drop-shadow(0 1px 2px rgba(0,0,0,.7))"
        pointerEvents="none"
        aria-hidden="true"
      >
        <MdLocationOn size={48} />
      </Box>

      <Grid
        position="absolute"
        top="8px"
        right="8px"
        templateColumns="repeat(3, 34px)"
        templateRows="repeat(3, 34px)"
        gap="2px"
        zIndex={1}
      >
        <Box />
        <IconButton
          aria-label="Przesuń mapę w górę"
          icon={<MdArrowUpward />}
          type="button"
          size="sm"
          w="34px"
          minW="34px"
          h="34px"
          bg={controlBg}
          color={controlColor}
          isDisabled={!readyForPan}
          onClick={(event) => {
            const map = event.currentTarget.closest('[role="group"]') as HTMLElement | null;
            if (map) commitButtonPan(0, -BUTTON_PAN_STEP, map.clientWidth, map.clientHeight);
          }}
        />
        <Box />
        <IconButton
          aria-label="Przesuń mapę w lewo"
          icon={<MdArrowLeft />}
          type="button"
          size="sm"
          w="34px"
          minW="34px"
          h="34px"
          bg={controlBg}
          color={controlColor}
          isDisabled={!readyForPan}
          onClick={(event) => {
            const map = event.currentTarget.closest('[role="group"]') as HTMLElement | null;
            if (map) commitButtonPan(-BUTTON_PAN_STEP, 0, map.clientWidth, map.clientHeight);
          }}
        />
        <Box aria-hidden="true" />
        <IconButton
          aria-label="Przesuń mapę w prawo"
          icon={<MdArrowRight />}
          type="button"
          size="sm"
          w="34px"
          minW="34px"
          h="34px"
          bg={controlBg}
          color={controlColor}
          isDisabled={!readyForPan}
          onClick={(event) => {
            const map = event.currentTarget.closest('[role="group"]') as HTMLElement | null;
            if (map) commitButtonPan(BUTTON_PAN_STEP, 0, map.clientWidth, map.clientHeight);
          }}
        />
        <Box />
        <IconButton
          aria-label="Przesuń mapę w dół"
          icon={<MdArrowDownward />}
          type="button"
          size="sm"
          w="34px"
          minW="34px"
          h="34px"
          bg={controlBg}
          color={controlColor}
          isDisabled={!readyForPan}
          onClick={(event) => {
            const map = event.currentTarget.closest('[role="group"]') as HTMLElement | null;
            if (map) commitButtonPan(0, BUTTON_PAN_STEP, map.clientWidth, map.clientHeight);
          }}
        />
        <Box />
      </Grid>

      <Flex
        position="absolute"
        left="8px"
        top="8px"
        direction="column"
        gap="2px"
        zIndex={1}
      >
        <IconButton
          aria-label="Przybliż mapę"
          icon={<MdAdd />}
          type="button"
          size="sm"
          w="34px"
          minW="34px"
          h="34px"
          bg={controlBg}
          color={controlColor}
          isDisabled={disabled || zoom >= MAX_LOCATION_MAP_ZOOM}
          onClick={() => changeZoomBy(1)}
        />
        <IconButton
          aria-label="Oddal mapę"
          icon={<MdRemove />}
          type="button"
          size="sm"
          w="34px"
          minW="34px"
          h="34px"
          bg={controlBg}
          color={controlColor}
          isDisabled={disabled || zoom <= MIN_LOCATION_MAP_ZOOM}
          onClick={() => changeZoomBy(-1)}
        />
      </Flex>

      {busy ? (
        <Flex
          position="absolute"
          left="8px"
          bottom="8px"
          align="center"
          gap="7px"
          px="9px"
          py="6px"
          borderRadius="4px"
          bg={statusBg}
          color="white"
          pointerEvents="none"
          aria-live="polite"
        >
          <Spinner size="xs" />
          <Text fontSize="xs">Ładowanie obrazu mapy…</Text>
        </Flex>
      ) : null}

      {error ? (
        <Alert
          status="error"
          position="absolute"
          left="8px"
          top="120px"
          maxW="calc(100% - 16px)"
          zIndex={2}
          borderRadius="6px"
          alignItems="center"
          gap="8px"
        >
          <AlertIcon />
          <Text flex="1" minW="0" fontSize="sm">{error}</Text>
          <Button
            size="sm"
            flexShrink={0}
            onClick={() => {
              const nextRetry = retryNumber + 1;
              if (pendingPanKey.current === requestKey) {
                pendingPanKey.current = makeMapRequestKey(provider, latitude, longitude, zoom, nextRetry);
              }
              setRetryNumber(nextRetry);
            }}
            isDisabled={disabled}
          >
            Spróbuj ponownie
          </Button>
        </Alert>
      ) : null}
    </Box>
  );
}
