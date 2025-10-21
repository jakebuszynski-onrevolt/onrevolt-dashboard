'use client';
// Custom components
import Card from 'components/card/Card';
import { useColorModeValue } from '@chakra-ui/react';
import { Map, Source, useMap } from 'react-map-gl';
import { TiledMapService } from 'mapbox-gl-esri-sources';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect } from 'react';

const MAPBOX_TOKEN = 'pk.eyJ1Ijoic2ltbW1wbGUiLCJhIjoiY2wxeG1hd24xMDEzYzNrbWs5emFkdm16ZiJ9.q9s0sSKQFFaT9fyrC-7--g'; // Set your mapbox token her

export default function YourTransfers(props: { [x: string]: any }) {
    const { ...rest } = props;
    const mapStyles = useColorModeValue(
        'mapbox://styles/simmmple/ckwxecg1wapzp14s9qlus38p0',
        'mapbox://styles/simmmple/cl0qqjr3z000814pq7428ptk5'
    );
    const { current:map } = useMap();
    useEffect(() => {
        // map0.flyTo({ center: [-122.4, 37.8] });
        // new TiledMapService('imagery-source', map, {
        //     url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
        // })
        // map.addLayer({
        //     id: 'imagery-layer',
        //     type: 'raster',
        //     source: 'imagery-source'
        // })
    }, [

    ]);
    return (
        <Card
            justifyContent="center"
            flexDirection="column"
            w="100%"
            pb="20px"
            minH={{ base: '100%', lg: '100%' }}
            {...rest}
        >
            <Map
                id="map0"
                initialViewState={{
                    latitude: 52.1910972,
                    longitude: 19.3554056,
                    zoom: 3.75,
                }}
                style={{
                    borderRadius: '20px',
                    width: '100%',
                    minHeight: '100%',
                }}
                mapStyle="mapbox://styles/mapbox/satellite-v9"
                mapboxAccessToken={MAPBOX_TOKEN}
            >
                <Source
                    id="terrain-dem"
                    type="raster"
                    url="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"
                    tileSize={256}
                />
            </Map>
        </Card>
    );
}
