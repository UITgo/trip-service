export type RegionCode = 'HCM' | 'HN' | string;
export interface RegionShardConfig {
    driverStreamBaseUrl: string;
}
export declare const REGION_SHARD_CONFIG: Record<RegionCode, RegionShardConfig>;
export declare function getDriverStreamUrl(cityCode?: string | null): string;
