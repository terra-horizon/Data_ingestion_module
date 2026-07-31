const { createHash } = require('node:crypto');
const AppError = require('../../utils/app-error');

class RiverTileGenerator {
  generate({ aoi, riverNetwork, params, now = new Date().toISOString() }) {
    if (!riverNetwork || !Array.isArray(riverNetwork.rivers)) {
      throw new AppError('River network is invalid', 502, 'INVALID_RIVER_NETWORK');
    }
    const riverNetworkHash = hash(riverNetwork.rivers.map((river) => ({
      riverId: river.riverId,
      geometry: river.geometry
    })));
    const centers = [];
    for (const river of riverNetwork.rivers) {
      const coordinates = river.geometry?.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
      const lengthM = lineLength(coordinates);
      if (lengthM < params.minRiverLengthM) continue;
      centers.push(...sampleLine(coordinates, params.spacingM).map((point) => ({
        point,
        riverId: river.riverId
      })));
    }
    const unique = new Map();
    for (const center of centers) {
      const key = center.point.map((value) => value.toFixed(7)).join(',');
      if (!unique.has(key)) unique.set(key, center);
    }
    const selected = [...unique.values()].slice(0, params.maxTiles);
    if (!selected.length) throw new AppError('No canonical river tiles were generated', 422, 'NO_RIVER_TILES');
    return selected.map(({ point: [lon, lat], riverId }) => {
      const bbox = squareBbox(lon, lat, params.sizeM);
      const tileId = `tile_${hash({ aoiId: aoi.aoiId, bbox: bbox.map((value) => Number(value.toFixed(8))), params }).slice(0, 20)}`;
      return {
        tileId,
        aoiId: aoi.aoiId,
        aoiDefinitionHash: aoi.aoiDefinitionHash,
        riverNetworkHash,
        riverId,
        bbox,
        geometry: polygon(bbox),
        centroid: { type: 'Point', coordinates: [lon, lat] },
        source: riverNetwork.source,
        generationParams: {
          spacingM: params.spacingM,
          sizeM: params.sizeM,
          minRiverLengthM: params.minRiverLengthM
        },
        status: 'active',
        createdAt: now,
        updatedAt: now
      };
    });
  }
}

function sampleLine(coordinates, spacingM) {
  const points = [coordinates[0]];
  let remaining = spacingM;
  for (let index = 1; index < coordinates.length; index += 1) {
    let start = coordinates[index - 1];
    const end = coordinates[index];
    let segmentLength = distance(start, end);
    while (segmentLength >= remaining) {
      const fraction = remaining / segmentLength;
      start = [
        start[0] + ((end[0] - start[0]) * fraction),
        start[1] + ((end[1] - start[1]) * fraction)
      ];
      points.push(start);
      segmentLength = distance(start, end);
      remaining = spacingM;
    }
    remaining -= segmentLength;
  }
  return points;
}

function lineLength(coordinates) {
  return coordinates.slice(1).reduce((total, point, index) => total + distance(coordinates[index], point), 0);
}

function distance([lon1, lat1], [lon2, lat2]) {
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians;
  const dLon = (lon2 - lon1) * radians;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function squareBbox(lon, lat, sizeM) {
  const half = sizeM / 2;
  const latOffset = half / 110540;
  const lonOffset = half / (111320 * Math.max(Math.cos(lat * Math.PI / 180), 0.1));
  return [lon - lonOffset, lat - latOffset, lon + lonOffset, lat + latOffset];
}

function polygon([minLon, minLat, maxLon, maxLat]) {
  return {
    type: 'Polygon',
    coordinates: [[
      [minLon, minLat], [maxLon, minLat], [maxLon, maxLat],
      [minLon, maxLat], [minLon, minLat]
    ]]
  };
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

module.exports = RiverTileGenerator;
