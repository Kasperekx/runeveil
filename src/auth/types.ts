export interface AuthAccount {
  id: string;
  email: string;
}

export interface AuthCharacter {
  id: string;
  name: string;
  classId: string;
  level: number;
  customized: boolean;
}

export interface AuthSession {
  authenticated: true;
  account: AuthAccount;
  characters: AuthCharacter[];
}

export interface GameAccess {
  account: AuthAccount;
  characterId: string;
  classId: string;
  characterName: string;
}
