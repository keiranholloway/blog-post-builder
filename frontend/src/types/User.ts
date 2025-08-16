import type { Platform, PlatformConnection } from './PlatformConnection';

export interface UserPreferences {
  defaultPlatforms: Platform[];
  autoPublish: boolean;
  imageGenerationEnabled: boolean;
  voiceInputEnabled: boolean;
  theme: 'light' | 'dark' | 'auto';
}

export interface User {
  id: string;
  email: string;
  writingStyleContext: string;
  connectedPlatforms: PlatformConnection[];
  preferences: UserPreferences;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserCreateInput {
  email: string;
  writingStyleContext?: string;
  preferences?: Partial<UserPreferences>;
}

export interface UserUpdateInput {
  writingStyleContext?: string;
  preferences?: Partial<UserPreferences>;
}