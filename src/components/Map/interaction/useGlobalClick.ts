import { includes, map } from "lodash";
import { useCallback, useEffect, useRef } from "react";
import { canInteract } from "@/components/Map/interaction/interactionConfig";
import type { LocationInfo } from "../../../helper/map-data/LocationInfo";
import { getInteractionLayerIds } from "../historical/data";
import { getBuildingLocationInfo, unclusteredLayerIds } from "./building";
import { getHistoricalLocationInfo } from "./historical";
import usePanelStore from "./panel/panelStore";

interface GlobalClickProps {
	mapInstance: mapboxgl.Map | null;
	onShowDetailedInfo?: (data: LocationInfo) => void;
	minZoomLevel?: number; // 触发详细信息查询的最小缩放级别
}

export const useGlobalClick = ({
	mapInstance,
	onShowDetailedInfo,
	minZoomLevel = 17,
}: GlobalClickProps) => {
	const hasRegisteredRef = useRef<boolean>(false);

	// 查询指定图层的要素 - 公共方法
	const queryInteractiveFeatures = useCallback(
		(point: mapboxgl.Point) => {
			const interactiveLayerIds = [
				...unclusteredLayerIds,
				...getInteractionLayerIds(),
			];

			if (interactiveLayerIds.length === 0) {
				return [];
			}

			// 只查询可交互的图层
			const features = mapInstance?.queryRenderedFeatures(point, {
				layers: interactiveLayerIds,
			});

			return features;
		},
		[mapInstance],
	);

	// 全局统一事件处理 - 使用过滤后的图层查询
	const handleGlobalClick = useCallback(
		(e: mapboxgl.MapMouseEvent) => {
			if (!mapInstance || !onShowDetailedInfo) {
				return;
			}

			// 检查地图是否已完全加载
			if (!mapInstance.isStyleLoaded()) {
				return;
			}

			const currentZoom = mapInstance.getZoom();
			if (
				!canInteract(currentZoom, "minZoomForLabelClicks") ||
				currentZoom <= minZoomLevel
			) {
				return;
			}

			const panelStore = usePanelStore.getState();
			if (panelStore.isOpen && !panelStore.isFullscreen) {
				usePanelStore.setState({
					isFullscreen: true,
					showOverview: true,
				});
				return false;
			}

			// 使用新的公共方法查询可交互图层的要素
			const interactiveFeatures = queryInteractiveFeatures(e.point);

			// 检查是否有可交互的要素
			if (!interactiveFeatures || interactiveFeatures.length === 0) {
				return;
			}

			// 取第一个要素（最上层的可交互要素）
			const feature = interactiveFeatures[0];
			const layerId = feature.layer?.id;

			if (layerId) {
				// 阻止事件传递给其他监听器
				e.preventDefault();
				e.originalEvent?.preventDefault();
				e.originalEvent?.stopPropagation();
				e.originalEvent?.stopImmediatePropagation();

				let coordinates: [number, number];
				if (feature.geometry?.type === "Point") {
					coordinates = (feature.geometry as any).coordinates.slice();
				} else {
					coordinates = [e.lngLat.lng, e.lngLat.lat];
				}

				let locationInfo: LocationInfo;
				if (includes(unclusteredLayerIds, layerId)) {
					locationInfo = getBuildingLocationInfo(feature);
				} else if (includes(getInteractionLayerIds(), layerId)) {
					locationInfo = getHistoricalLocationInfo(feature);
				} else {
					console.warn("图层ID不再交互范围内:", layerId);
					return false;
				}

				locationInfo.coordinates = coordinates;
				onShowDetailedInfo(locationInfo);

				// 返回 false 进一步阻止事件传递
				return false;
			}
		},
		[mapInstance, onShowDetailedInfo, minZoomLevel, queryInteractiveFeatures],
	);

	// 延迟注册全局事件监听器 - 只执行一次
	useEffect(() => {
		if (!mapInstance || hasRegisteredRef.current) return;

		// 等待地图样式加载完成再注册事件监听器
		const registerEvents = () => {
			if (mapInstance.isStyleLoaded()) {
				// 注册全局事件监听器
				mapInstance.on("click", handleGlobalClick);

				hasRegisteredRef.current = true;
			} else {
				// 如果样式还没加载完成，监听style.load事件
				mapInstance.once("style.load", () => {
					mapInstance.on("click", handleGlobalClick);

					hasRegisteredRef.current = true;
				});
			}
		};

		registerEvents();

		// 清理函数
		return () => {
			if (hasRegisteredRef.current) {
				try {
					mapInstance.off("click", handleGlobalClick);
					console.log("🧹 已清理全局标签交互事件");
				} catch (error) {
					console.warn("清理全局事件监听器失败:", error);
				}
			}

			hasRegisteredRef.current = false;
		};
	}, [mapInstance, handleGlobalClick]);
};
