import { desktopChannels } from '../../shared/desktop-api';

// These requests use network data or preferences stored outside the content directory.
// Unknown requests still block migration so new file operations remain protected.
const independentQueries = new Set<string>([
  desktopChannels.getHome,
  desktopChannels.getNewsState,
  desktopChannels.getSettings,
  desktopChannels.getVisualPreferences,
  desktopChannels.getAppInfo,
  desktopChannels.getAccounts,
  desktopChannels.getAccountSkinUrl,
  desktopChannels.getSkins,
  desktopChannels.getCapes,
  desktopChannels.getSocial,
  desktopChannels.searchSocialUsers,
  desktopChannels.getSocialProfile,
  desktopChannels.getOwnSocialProfile,
  desktopChannels.getChatConversations,
  desktopChannels.getChatMessages,
  desktopChannels.getSocialServers,
  desktopChannels.getMusic,
  desktopChannels.searchMusic,
  desktopChannels.getMusicFavorites,
  desktopChannels.getMusicInvites,
  desktopChannels.getMusicPlaylistCollaboration,
  desktopChannels.getMusicPlaylistActivity,
  desktopChannels.getMusicPlaybackState,
  desktopChannels.getDownloadCatalog,
  desktopChannels.getPlayVersions,
  desktopChannels.getLoaderBuilds,
  desktopChannels.getLoaderGameVersions,
  desktopChannels.getBattlyClientBuilds,
  desktopChannels.getLabyModVersions,
  desktopChannels.getMinecraftVersionList,
  desktopChannels.getModVersionCatalog,
  desktopChannels.searchMods,
  desktopChannels.getModProjectDetails,
  desktopChannels.getThemeMarketplace,
  desktopChannels.getThemeReviewStatus,
  desktopChannels.getUpdates,
  desktopChannels.getWorldsSnapshot,
  desktopChannels.worldsPublicRooms,
  desktopChannels.notices,
]);

export function blocksDataRootMigration(channel: string): boolean {
  return channel !== desktopChannels.migrateBattlyDataRoot && !independentQueries.has(channel);
}
