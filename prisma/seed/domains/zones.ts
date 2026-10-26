// Zones d'intervention à Douala et quartiers (repères OpenStreetMap, positions sur la carte illustrée, contours).
import { logCount, nullableJson, readSeedData, type Tx } from '../support.js';
import type { ZoneSeed } from '../types.js';

export async function seedZones(tx: Tx): Promise<void> {
  const zones = readSeedData<ZoneSeed[]>('zones');
  let quarters = 0;
  for (const { quarters: zoneQuarters, id, area, ...zone } of zones) {
    const saved = await tx.zone.upsert({
      where: { key: zone.key },
      update: {},
      create: { ...zone, id, area: nullableJson(area), isDemo: false },
      select: { id: true },
    });
    for (const quarter of zoneQuarters) {
      await tx.zoneQuarter.upsert({
        where: { normalizedName: quarter.normalizedName },
        update: {},
        create: { ...quarter, zoneId: saved.id },
      });
      quarters += 1;
    }
  }
  logCount('Zones', zones.length);
  logCount('Quartiers', quarters);
}
