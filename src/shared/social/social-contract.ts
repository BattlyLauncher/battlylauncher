export interface SocialFriend {
  readonly activity: string;
  readonly gameVersion?: string;
  readonly client: string;
  readonly status: 'offline' | 'online';
  readonly server: { readonly host: string; readonly port: number } | null;
  readonly username: string;
  readonly userId: string;
}

export interface SocialProfile {
  readonly userId: string;
  readonly uuid?: string | null;
  readonly username: string;
  readonly bio: string;
  readonly badges: readonly string[];
  readonly roles: readonly string[];
  readonly premium: boolean;
  readonly skinUrl: string | null;
  readonly backgroundImageUrl: string | null;
  readonly customization: ProfileCustomization;
  readonly createdAt: string | null;
}

export type ProfileBorderStyle = 'solid' | 'dashed' | 'dotted' | 'double' | 'groove' | 'ridge';

export interface ProfileCustomization {
  readonly borderColor: string;
  readonly borderStyle: ProfileBorderStyle;
  readonly borderWidth: number;
  readonly nameColor: string;
  readonly backgroundColor: string;
  readonly backgroundImage: string | null;
}

export interface ProfileBackgroundSelection {
  readonly value: string;
  readonly previewUrl: string;
}

export const defaultProfileCustomization: ProfileCustomization = {
  borderColor: '#7289da',
  borderStyle: 'solid',
  borderWidth: 3,
  nameColor: '#ffffff',
  backgroundColor: '#2c2f33',
  backgroundImage: null,
};

const profileColorPattern = /^#[0-9a-f]{6}$/i;
const profileBorderStyles = new Set<ProfileBorderStyle>([
  'solid',
  'dashed',
  'dotted',
  'double',
  'groove',
  'ridge',
]);

function profileOwn(source: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
}

function profileColor(value: unknown): string {
  if (typeof value !== 'string' || !profileColorPattern.test(value)) {
    throw new TypeError('Invalid profile color');
  }
  return value.toLowerCase();
}

export function normalizeProfileCustomization(value: unknown): ProfileCustomization {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid profile customization');
  }
  const source = value as Record<string, unknown>;
  const borderStyle = profileOwn(source, 'borderStyle');
  const borderWidth = Number(profileOwn(source, 'borderWidth'));
  const backgroundImage = profileOwn(source, 'backgroundImage');
  if (!profileBorderStyles.has(borderStyle as ProfileBorderStyle)) {
    throw new TypeError('Invalid profile border style');
  }
  if (!Number.isInteger(borderWidth) || borderWidth < 1 || borderWidth > 10) {
    throw new TypeError('Invalid profile border width');
  }
  const relativeBackground =
    typeof backgroundImage === 'string' &&
    /^\/profile-backgrounds\/(?!.*\.\.)[A-Za-z0-9._/-]+$/.test(backgroundImage);
  if (
    backgroundImage !== null &&
    backgroundImage !== '' &&
    (typeof backgroundImage !== 'string' ||
      backgroundImage.length > 2048 ||
      (!/^https:\/\//i.test(backgroundImage) && !relativeBackground))
  ) {
    throw new TypeError('Invalid profile background image');
  }
  return {
    borderColor: profileColor(profileOwn(source, 'borderColor')),
    borderStyle: borderStyle as ProfileBorderStyle,
    borderWidth,
    nameColor: profileColor(profileOwn(source, 'nameColor')),
    backgroundColor: profileColor(profileOwn(source, 'backgroundColor')),
    backgroundImage:
      typeof backgroundImage === 'string' && backgroundImage ? backgroundImage : null,
  };
}

export interface ChatConversation {
  readonly id: string;
  readonly recipientId: string;
  readonly username: string;
  readonly lastMessage: string;
  readonly unread: number;
}

export interface ChatMessage {
  readonly id: string;
  readonly author: string;
  readonly content: string;
  readonly createdAt: string;
}

export interface SocialServer {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly members: number;
  readonly verified: boolean;
}

export interface SocialSnapshot {
  readonly friends: readonly SocialFriend[];
  readonly receivedRequests: readonly string[];
  readonly sentRequests: readonly string[];
}

export type SocialRealtimeState =
  'connected' | 'connecting' | 'disconnected' | 'error' | 'reconnecting';

export type SocialAction = 'accept' | 'cancel' | 'reject' | 'remove' | 'send';

export interface RemoteLaunchRequest {
  readonly instanceId: string;
  readonly javaPath?: string;
}

export function normalizeRemoteLaunchRequest(value: unknown): RemoteLaunchRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid remote launch request');
  }
  const instanceId = Object.getOwnPropertyDescriptor(value, 'instanceId')?.value as unknown;
  if (
    typeof instanceId !== 'string' ||
    !instanceId ||
    instanceId.length > 128 ||
    !/^[A-Za-z0-9._-]+$/.test(instanceId)
  ) {
    throw new TypeError('Invalid remote instance id');
  }
  const javaPath: unknown = Object.getOwnPropertyDescriptor(value, 'javaPath')?.value;
  if (
    javaPath !== undefined &&
    (typeof javaPath !== 'string' || javaPath.length > 4096 || javaPath.includes('\0'))
  ) {
    throw new TypeError('Invalid remote Java path');
  }
  return { instanceId, ...(typeof javaPath === 'string' ? { javaPath } : {}) };
}

export function normalizeSocialUsername(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 64 ||
    !/^[A-Za-z0-9_.+-]+$/.test(value)
  ) {
    throw new TypeError('Invalid social username');
  }
  return value;
}

export function normalizeSocialAction(value: unknown): SocialAction {
  if (!['accept', 'cancel', 'reject', 'remove', 'send'].includes(String(value))) {
    throw new TypeError('Invalid social action');
  }
  return value as SocialAction;
}
