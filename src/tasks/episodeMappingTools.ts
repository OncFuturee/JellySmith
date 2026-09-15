import type { EpisodeMapping } from "../models";

export type EpisodeGap = { season: number; from: number; to: number };
export type EpisodeOverlap = {
  season: number;
  episode: number;
  fileIds: string[];
};

export function analyzeEpisodeMappings(mappings: EpisodeMapping[]) {
  const gaps: EpisodeGap[] = [];
  const overlaps: EpisodeOverlap[] = [];
  const issueFileIds = new Set<string>();
  const seasons = new Map<number, EpisodeMapping[]>();
  for (const mapping of mappings) {
    const items = seasons.get(mapping.season) ?? [];
    items.push(mapping);
    seasons.set(mapping.season, items);
    if (!mapping.confirmed) issueFileIds.add(mapping.fileId);
  }
  for (const [season, items] of seasons) {
    const occupied = new Map<number, string[]>();
    for (const item of items) {
      const end = Math.max(item.episode, item.episodeEnd ?? item.episode);
      for (let episode = item.episode; episode <= end; episode += 1) {
        const owners = occupied.get(episode) ?? [];
        owners.push(item.fileId);
        occupied.set(episode, owners);
      }
    }
    const maximum = Math.max(0, ...occupied.keys());
    let gapStart: number | undefined;
    for (let episode = 1; episode <= maximum + 1; episode += 1) {
      const missing = episode <= maximum && !occupied.has(episode);
      if (missing && gapStart === undefined) gapStart = episode;
      if (!missing && gapStart !== undefined) {
        const gap = { season, from: gapStart, to: episode - 1 };
        gaps.push(gap);
        items
          .filter((item) => item.episode > gap.to)
          .forEach((item) => issueFileIds.add(item.fileId));
        gapStart = undefined;
      }
    }
    for (const [episode, fileIds] of occupied) {
      if (fileIds.length < 2) continue;
      overlaps.push({ season, episode, fileIds });
      fileIds.forEach((id) => issueFileIds.add(id));
    }
  }
  return {
    gaps,
    overlaps,
    unconfirmed: mappings.filter((item) => !item.confirmed).length,
    issueFileIds,
    missingCount: gaps.reduce((total, gap) => total + gap.to - gap.from + 1, 0),
  };
}

export function offsetEpisodeMappings(
  mappings: EpisodeMapping[],
  selected: Set<string>,
  offset: number,
) {
  return mappings.map((mapping) => {
    if (!selected.has(mapping.fileId)) return mapping;
    const span = Math.max(0, (mapping.episodeEnd ?? mapping.episode) - mapping.episode);
    const episode = Math.max(1, mapping.episode + offset);
    return {
      ...mapping,
      episode,
      episodeEnd: mapping.episodeEnd === undefined ? undefined : episode + span,
      confirmed: false,
    };
  });
}

export function renumberEpisodeMappings(
  mappings: EpisodeMapping[],
  orderedFileIds: string[],
  season: number,
  startEpisode: number,
) {
  const numbers = new Map<string, { episode: number; episodeEnd?: number }>();
  let next = Math.max(1, startEpisode);
  for (const fileId of orderedFileIds) {
    const mapping = mappings.find((item) => item.fileId === fileId);
    if (!mapping) continue;
    const span = Math.max(0, (mapping.episodeEnd ?? mapping.episode) - mapping.episode);
    numbers.set(fileId, {
      episode: next,
      episodeEnd: mapping.episodeEnd === undefined ? undefined : next + span,
    });
    next += span + 1;
  }
  return mappings.map((mapping) => {
    const number = numbers.get(mapping.fileId);
    return number
      ? { ...mapping, ...number, season, confirmed: false }
      : mapping;
  });
}
