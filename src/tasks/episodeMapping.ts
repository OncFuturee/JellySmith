import type {
  AiEpisodeMappingProposal,
  EpisodeMapping,
  ScannedFile,
} from "../models";

export type AiEpisodeEvidence = {
  confidence: number;
  reason: string;
};

export function ensureEditableEpisodeMappings(
  currentMappings: EpisodeMapping[],
  groupFileIds: string[],
  files: ScannedFile[],
) {
  const groupIds = new Set(groupFileIds);
  const videos = files
    .filter((file) => file.kind === "video" && groupIds.has(file.id))
    .sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  const currentByFile = new Map(
    currentMappings.map((mapping) => [mapping.fileId, mapping]),
  );
  const defaultSeason =
    currentMappings[0]?.season ??
    videos.find((file) => file.parsed.season !== undefined)?.parsed.season ??
    1;
  const occupied = new Map<number, Set<number>>();
  const reserve = (season: number, episode: number) => {
    const episodes = occupied.get(season) ?? new Set<number>();
    episodes.add(episode);
    occupied.set(season, episodes);
  };
  for (const file of videos) {
    const existing = currentByFile.get(file.id);
    const season = existing?.season ?? file.parsed.season ?? defaultSeason;
    const episode = existing?.episode ?? file.parsed.episodes[0];
    if (episode && episode > 0) reserve(season, episode);
  }
  return videos.map((file) => {
    const existing = currentByFile.get(file.id);
    if (existing) return existing;
    const season = file.parsed.season ?? defaultSeason;
    const parsedEpisode = file.parsed.episodes[0];
    let episode = parsedEpisode && parsedEpisode > 0 ? parsedEpisode : 1;
    const used = occupied.get(season) ?? new Set<number>();
    if (!parsedEpisode) {
      while (used.has(episode)) episode += 1;
    }
    reserve(season, episode);
    const parsedEnd = file.parsed.episodes[1];
    return {
      fileId: file.id,
      season,
      episode,
      episodeEnd:
        parsedEnd !== undefined && parsedEnd >= episode
          ? parsedEnd
          : undefined,
      title: "",
      confirmed: false,
    };
  });
}

export function mergeAiEpisodeMappings(
  currentMappings: EpisodeMapping[],
  proposals: AiEpisodeMappingProposal[],
) {
  const mappings = new Map(
    currentMappings.map((mapping) => [mapping.fileId, mapping]),
  );
  for (const proposal of proposals) {
    mappings.set(proposal.fileId, {
      fileId: proposal.fileId,
      season: proposal.season,
      episode: proposal.episode,
      episodeEnd: proposal.episodeEnd,
      title: proposal.title || mappings.get(proposal.fileId)?.title || "",
      confirmed: false,
    });
  }
  return {
    mappings: [...mappings.values()],
    evidence: Object.fromEntries(
      proposals.map((proposal) => [
        proposal.fileId,
        { confidence: proposal.confidence, reason: proposal.reason },
      ]),
    ) as Record<string, AiEpisodeEvidence>,
  };
}
