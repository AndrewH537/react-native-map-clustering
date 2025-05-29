import React, {
  memo,
  useState,
  useEffect,
  useMemo,
  useRef,
  forwardRef,
} from "react";
import { Dimensions, LayoutAnimation, Platform } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import SuperCluster from "supercluster";
import ClusterMarker from "./ClusteredMarker";
import {
  isMarker,
  markerToGeoJSONFeature,
  calculateBBox,
  returnMapZoom,
  generateSpiral,
} from "./helpers";

const ClusteredMapView = forwardRef(
  (
    {
      radius,
      maxZoom,
      minZoom,
      minPoints,
      extent,
      nodeSize,
      children,
      onClusterPress,
      onRegionChangeComplete,
      onMarkersChange,
      preserveClusterPressBehavior,
      clusteringEnabled,
      clusterColor,
      clusterTextColor,
      clusterFontFamily,
      spiderLineColor,
      layoutAnimationConf,
      animationEnabled,
      renderCluster,
      tracksViewChanges,
      spiralEnabled,
      superClusterRef,
      ...restProps
    },
    ref
  ) => {
    const [markers, updateMarkers] = useState([]);
    const [spiderMarkers, updateSpiderMarker] = useState([]);
    const [otherChildren, updateChildren] = useState([]);
    const [superCluster, setSuperCluster] = useState(null);
    const [currentRegion, updateRegion] = useState(
      restProps.region || restProps.initialRegion
    );

    const [isSpiderfier, updateSpiderfier] = useState(false);
    const [clusterChildren, updateClusterChildren] = useState(null);
    const mapRef = useRef();

    const propsChildren = useMemo(() => React.Children.toArray(children), [
      children,
    ]);

    useEffect(() => {
      const rawData = [];
      const otherChildren = [];

      if (!clusteringEnabled) {
        updateSpiderMarker([]);
        updateMarkers([]);
        updateChildren(propsChildren);
        setSuperCluster(null);
        return;
      }

      propsChildren.forEach((child, index) => {
        if (isMarker(child)) {
          rawData.push(markerToGeoJSONFeature(child, index));
        } else {
          otherChildren.push(child);
        }
      });

      const superCluster = new SuperCluster({
        radius,
        maxZoom,
        minZoom,
        minPoints,
        extent,
        nodeSize,
      });

      superCluster.load(rawData);

      const bBox = calculateBBox(currentRegion);
      const zoom = returnMapZoom(currentRegion, bBox, minZoom);
      const markers = superCluster.getClusters(bBox, zoom);

      updateMarkers(markers);
      updateChildren(otherChildren);
      setSuperCluster(superCluster);

      if (superClusterRef && typeof superClusterRef === 'object' && 'current' in superClusterRef) {
        //console.log('ClusteredMapView: setting superClusterRef.current = superCluster', superClusterRef);
        superClusterRef.current = superCluster;
      } else if (superClusterRef) {
        //console.warn('ClusteredMapView: superClusterRef is not a valid ref object, skipping superClusterRef.current assignment:', superClusterRef);
      }
    }, [propsChildren, clusteringEnabled]);

    useEffect(() => {
      if (!spiralEnabled) return;

      if (isSpiderfier && markers.length > 0) {
        let allSpiderMarkers = [];
        let spiralChildren = [];
        markers.map((marker, i) => {
          if (marker.properties.cluster) {
            spiralChildren = superCluster.getLeaves(
              marker.properties.cluster_id,
              Infinity
            );
          }
          let positions = generateSpiral(marker, spiralChildren, markers, i);
          allSpiderMarkers.push(...positions);
        });

        updateSpiderMarker(allSpiderMarkers);
      } else {
        updateSpiderMarker([]);
      }
    }, [isSpiderfier, markers]);

    const _onRegionChangeComplete = (region) => {
      if (superCluster && region) {
        const bBox = calculateBBox(region);
        const zoom = returnMapZoom(region, bBox, minZoom);
        const markers = superCluster.getClusters(bBox, zoom);
        console.log('layoutAnimationConf:', layoutAnimationConf);
        if (animationEnabled && Platform.OS === "ios" && layoutAnimationConf && layoutAnimationConf.duration) {
          LayoutAnimation.configureNext(layoutAnimationConf);
        }
        if (zoom >= 18 && markers.length > 0 && clusterChildren) {
          if (spiralEnabled) updateSpiderfier(true);
        } else {
          if (spiralEnabled) updateSpiderfier(false);
        }
        updateMarkers(markers);
        onMarkersChange(markers);
        onRegionChangeComplete && onRegionChangeComplete(region, markers);
        console.log('onRegionChangeComplete called. Region:', region, 'Markers:', markers.length);
        updateRegion(region);
      } else {
        onRegionChangeComplete && onRegionChangeComplete(region);
        //onRegionChangeComplete(region);
      }
    };

    const _onClusterPress = (cluster) => () => {
      const children = superCluster.getLeaves(cluster.id, Infinity);
      updateClusterChildren(children);

      if (preserveClusterPressBehavior) {
        onClusterPress(cluster, children);
        return;
      }

      const coordinates = children.map(({ geometry }) => ({
        latitude: geometry.coordinates[1],
        longitude: geometry.coordinates[0],
      }));

      // Defensive patch: ensure options is always defined and log
      const fitOptions = restProps.edgePadding ? { edgePadding: restProps.edgePadding } : {};
      console.log('ClusteredMapView: fitToCoordinates called with', coordinates, fitOptions);
      if (mapRef.current && typeof mapRef.current.fitToCoordinates === 'function') {
        mapRef.current.fitToCoordinates(coordinates, fitOptions);
      } else {
        console.warn('ClusteredMapView: mapRef.current.fitToCoordinates is not a function', mapRef.current);
      }

      onClusterPress(cluster, children);
    };

    return (
      <MapView
        {...restProps}
        ref={(map) => {
          mapRef.current = map;
          if (ref && typeof ref === 'object' && 'current' in ref) {
            //console.log('ClusteredMapView: setting ref.current = map', ref);
            ref.current = map;
          } else if (ref) {
            console.warn('ClusteredMapView: ref is not a valid ref object, skipping ref.current assignment:', ref);
          }
          if (restProps.mapRef) {
            if (typeof restProps.mapRef === 'function') {
              restProps.mapRef(map);
            } else {
              console.warn('ClusteredMapView: mapRef is not a function:', restProps.mapRef);
            }
          }
        }}
        onRegionChangeComplete={_onRegionChangeComplete}
      >
        {markers.map((marker) =>
          marker.properties.point_count === 0 ? (
            propsChildren[marker.properties.index]
          ) : !isSpiderfier ? (
            renderCluster ? (
              renderCluster({
                onPress: _onClusterPress(marker),
                clusterColor,
                clusterTextColor,
                clusterFontFamily,
                ...marker,
              })
            ) : (
              <ClusterMarker
                key={`cluster-${marker.id}`}
                {...marker}
                onPress={_onClusterPress(marker)}
                clusterColor={
                  restProps.selectedClusterId === marker.id
                    ? restProps.selectedClusterColor
                    : clusterColor
                }
                clusterTextColor={clusterTextColor}
                clusterFontFamily={clusterFontFamily}
                tracksViewChanges={tracksViewChanges}
              />
            )
          ) : null
        )}
        {otherChildren}
        {spiderMarkers.map((marker) => {
          return propsChildren[marker.index]
            ? React.cloneElement(propsChildren[marker.index], {
                coordinate: { ...marker },
              })
            : null;
        })}
        {spiderMarkers.map((marker, index) => (
          <Polyline
            key={index}
            coordinates={[marker.centerPoint, marker, marker.centerPoint]}
            strokeColor={spiderLineColor}
            strokeWidth={1}
          />
        ))}
      </MapView>
    );
  }
);

ClusteredMapView.defaultProps = {
  clusteringEnabled: true,
  spiralEnabled: true,
  animationEnabled: true,
  preserveClusterPressBehavior: false,
  layoutAnimationConf: {
    duration: 300,
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    update: { type: LayoutAnimation.Types.spring, springDamping: 0.7 },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity }
  },
  tracksViewChanges: false,
  // SuperCluster parameters
  radius: Dimensions.get("window").width * 0.06,
  maxZoom: 20,
  minZoom: 1,
  minPoints: 2,
  extent: 512,
  nodeSize: 64,
  // Map parameters
  edgePadding: { top: 50, left: 50, right: 50, bottom: 50 },
  // Cluster styles
  clusterColor: "#00B386",
  clusterTextColor: "#FFFFFF",
  spiderLineColor: "#FF0000",
  // Callbacks
  onRegionChangeComplete: () => {},
  onClusterPress: () => {},
  onMarkersChange: () => {},
  superClusterRef: { current: null },
  mapRef: () => {},
};

export default memo(ClusteredMapView);
