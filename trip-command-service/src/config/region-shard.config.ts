// TODO(ModuleA-Shard): Region-based sharding configuration for driver-stream
// Each region/city has its own driver-stream instance and Redis Geo

export type RegionCode = 'HCM' | 'HN' | string;

export interface RegionShardConfig {
  driverStreamBaseUrl: string;
  // TODO(ModuleA-Shard): Future: redisUrl, kafkaBrokers per region
}

export const REGION_SHARD_CONFIG: Record<RegionCode, RegionShardConfig> = {
  HCM: {
    driverStreamBaseUrl:
      process.env.DRIVER_STREAM_HCM_URL || 'http://driver-stream-hcm:8080',
  },
  HN: {
    driverStreamBaseUrl:
      process.env.DRIVER_STREAM_HN_URL || 'http://driver-stream-hn:8080',
  },
};

/**
 * Get driver-stream base URL for a given city/region code
 * @param cityCode City code (HCM, HN, etc.)
 * @returns Base URL for driver-stream shard, or default if cityCode not found
 */
export function getDriverStreamUrl(cityCode?: string | null): string {
  if (!cityCode) {
    // TODO(ModuleA-Shard): Default to HCM for demo. In production, should infer from lat/lng
    return REGION_SHARD_CONFIG.HCM.driverStreamBaseUrl;
  }

  const config = REGION_SHARD_CONFIG[cityCode.toUpperCase()];
  if (!config) {
    // Fallback to HCM if unknown city code
    return REGION_SHARD_CONFIG.HCM.driverStreamBaseUrl;
  }

  return config.driverStreamBaseUrl;
}

