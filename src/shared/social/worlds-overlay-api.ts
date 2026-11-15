import type { SocialFriend } from './social-contract';
import type { WorldsOverlayPreferences } from './worlds-overlay-preferences';
import type { BattlyDesktopApi } from '../desktop-api';
export interface WorldsOverlayApi extends Pick<
  BattlyDesktopApi,
  | 'getWorldsSnapshot'
  | 'worldsAction'
  | 'writeClipboardText'
  | 'getWorldsPublicRooms'
  | 'worldsVoiceCommand'
  | 'worldsVoiceParty'
  | 'onWorldsEvent'
> {
  respondLan(accept: boolean): Promise<void>;
  language(): Promise<string>;
  onLanPrompt(listener: (visible: boolean) => void): void;
  preferences(): Promise<WorldsOverlayPreferences>;
  configure(value: WorldsOverlayPreferences): Promise<void>;
  compactHeight(value: number): Promise<void>;
  onPreferences(listener: (value: WorldsOverlayPreferences) => void): void;
  expand(expanded: boolean): Promise<void>;
  friends(): Promise<readonly SocialFriend[]>;
  searchUsers(query: string): Promise<readonly string[]>;
  faceImageUrl(username: string): Promise<string>;
  onReveal(listener: () => void): void;
  onExpanded(listener: (value: boolean) => void): void;
  onGameVersion(listener: (value: string) => void): void;
}
