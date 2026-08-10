import { createHash, randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { PoolClient } from "pg";
import { database } from "../database.js";
import { CLASSES } from "../world/classConfig.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GAME_TICKET_TTL_MS = 60_000;
const MAX_CHARACTERS = 4;
const PASSWORD_HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

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

export interface AuthSessionView {
  account: AuthAccount;
  characters: AuthCharacter[];
}

interface AccountRow {
  id: string;
  email: string;
  password_hash: string;
  status: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase("en-US");
}

function normalizeCharacterName(name: string): string {
  return name
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("pl-PL");
}

async function characterRows(
  accountId: string,
  client: PoolClient | typeof database = database,
): Promise<AuthCharacter[]> {
  const result = await client.query<{
    id: string;
    name: string;
    class_id: string;
    level: number;
    customized: boolean;
  }>(
    `SELECT characters.id, characters.name, characters.class_id,
            COALESCE(players.level, 1)::INTEGER AS level,
            characters.customized
     FROM characters
     LEFT JOIN players ON players.player_id = characters.id::TEXT
     WHERE characters.account_id = $1
     ORDER BY characters.slot_index`,
    [accountId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    classId: row.class_id,
    level: row.level,
    customized: row.customized,
  }));
}

async function createSession(
  account: AuthAccount,
  client: PoolClient | typeof database = database,
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await client.query(
    `INSERT INTO auth_sessions (id, account_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [randomUUID(), account.id, hashToken(token), expiresAt],
  );
  return { token, expiresAt };
}

export const authStore = {
  normalizeEmail,
  normalizeCharacterName,

  async register(
    email: string,
    password: string,
  ): Promise<{
    view: AuthSessionView;
    sessionToken: string;
    sessionExpiresAt: Date;
  }> {
    const normalized = normalizeEmail(email);
    const passwordHash = await argon2.hash(password, PASSWORD_HASH_OPTIONS);
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const account: AuthAccount = { id: randomUUID(), email: email.trim() };
      await client.query(
        `INSERT INTO accounts (id, email, email_normalized, password_hash)
         VALUES ($1, $2, $3, $4)`,
        [account.id, account.email, normalized, passwordHash],
      );
      const session = await createSession(account, client);
      await client.query("COMMIT");
      return {
        view: { account, characters: [] },
        sessionToken: session.token,
        sessionExpiresAt: session.expiresAt,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async login(
    email: string,
    password: string,
  ): Promise<{
    view: AuthSessionView;
    sessionToken: string;
    sessionExpiresAt: Date;
  } | null> {
    const result = await database.query<AccountRow>(
      `SELECT id, email, password_hash, status
       FROM accounts WHERE email_normalized = $1`,
      [normalizeEmail(email)],
    );
    const row = result.rows[0];
    if (!row) {
      // Keep unknown-account requests in the same cost class as password checks.
      await argon2.hash(password, PASSWORD_HASH_OPTIONS);
      return null;
    }
    const passwordMatches = await argon2.verify(row.password_hash, password);
    if (!passwordMatches || row.status !== "active") return null;

    const account = { id: row.id, email: row.email };
    const session = await createSession(account);
    return {
      view: { account, characters: await characterRows(account.id) },
      sessionToken: session.token,
      sessionExpiresAt: session.expiresAt,
    };
  },

  async session(token: string): Promise<AuthSessionView | null> {
    const result = await database.query<{
      account_id: string;
      email: string;
    }>(
      `UPDATE auth_sessions AS sessions
       SET last_seen_at = NOW()
       FROM accounts
       WHERE sessions.token_hash = $1
         AND sessions.expires_at > NOW()
         AND accounts.id = sessions.account_id
         AND accounts.status = 'active'
       RETURNING sessions.account_id, accounts.email`,
      [hashToken(token)],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      account: { id: row.account_id, email: row.email },
      characters: await characterRows(row.account_id),
    };
  },

  async logout(token: string): Promise<void> {
    await database.query("DELETE FROM auth_sessions WHERE token_hash = $1", [
      hashToken(token),
    ]);
  },

  async createCharacter(
    sessionToken: string,
    name: string,
    classId: string,
  ): Promise<AuthCharacter | null | undefined> {
    const session = await this.session(sessionToken);
    if (!session) return undefined;
    if (!CLASSES[classId]) return null;

    const normalizedName = normalizeCharacterName(name);
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [
        session.account.id,
      ]);

      const placeholder = await client.query<{
        id: string;
        slot_index: number;
      }>(
        `SELECT characters.id, characters.slot_index
         FROM characters
         WHERE characters.account_id = $1
           AND characters.customized = FALSE
           AND NOT EXISTS (
             SELECT 1 FROM players WHERE players.player_id = characters.id::TEXT
           )
         ORDER BY characters.slot_index
         LIMIT 1`,
        [session.account.id],
      );

      let characterId: string;
      if (placeholder.rows[0]) {
        characterId = placeholder.rows[0].id;
        await client.query(
          `UPDATE characters
           SET name = $1, name_normalized = $2, class_id = $3,
               customized = TRUE, updated_at = NOW()
           WHERE id = $4`,
          [name, normalizedName, classId, characterId],
        );
      } else {
        const slots = await client.query<{ slot_index: number }>(
          `SELECT slot_index FROM characters
           WHERE account_id = $1 AND customized = TRUE
           ORDER BY slot_index`,
          [session.account.id],
        );
        if ((slots.rowCount ?? 0) >= MAX_CHARACTERS) {
          await client.query("ROLLBACK");
          return null;
        }
        const occupied = new Set(slots.rows.map((row) => row.slot_index));
        let slotIndex = 0;
        while (occupied.has(slotIndex)) slotIndex += 1;
        characterId = randomUUID();
        await client.query(
          `INSERT INTO characters
            (id, account_id, name, name_normalized, class_id, slot_index, customized)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
          [
            characterId,
            session.account.id,
            name,
            normalizedName,
            classId,
            slotIndex,
          ],
        );
      }

      await client.query("COMMIT");
      return {
        id: characterId,
        name,
        classId,
        level: 1,
        customized: true,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async deleteCharacter(
    sessionToken: string,
    characterId: string,
    confirmationName: string,
  ): Promise<"deleted" | "unauthorized" | "forbidden" | "name_mismatch"> {
    const session = await this.session(sessionToken);
    if (!session) return "unauthorized";

    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [
        session.account.id,
      ]);
      const result = await client.query<{
        id: string;
        name: string;
        customized: boolean;
      }>(
        `SELECT id, name, customized FROM characters
         WHERE id = $1 AND account_id = $2
         FOR UPDATE`,
        [characterId, session.account.id],
      );
      const character = result.rows[0];
      if (!character?.customized) {
        await client.query("ROLLBACK");
        return "forbidden";
      }
      if (
        normalizeCharacterName(character.name) !==
        normalizeCharacterName(confirmationName)
      ) {
        await client.query("ROLLBACK");
        return "name_mismatch";
      }

      // Player-owned tables cascade from players; auth tickets cascade from
      // characters. Both roots are removed in the same transaction.
      await client.query("DELETE FROM players WHERE player_id = $1", [
        characterId,
      ]);
      await client.query(
        "DELETE FROM characters WHERE id = $1 AND account_id = $2",
        [characterId, session.account.id],
      );
      await client.query("COMMIT");
      return "deleted";
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async createGameTicket(
    sessionToken: string,
    characterId: string,
  ): Promise<string | null> {
    const session = await this.session(sessionToken);
    if (
      !session?.characters.some(
        (character) => character.id === characterId && character.customized,
      )
    )
      return null;
    const token = newToken();
    await database.query(
      `INSERT INTO game_tickets
        (token_hash, account_id, character_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [
        hashToken(token),
        session.account.id,
        characterId,
        new Date(Date.now() + GAME_TICKET_TTL_MS),
      ],
    );
    return token;
  },

  async consumeGameTicket(token: string): Promise<{
    accountId: string;
    characterId: string;
    characterName: string;
    classId: string;
  } | null> {
    const result = await database.query<{
      account_id: string;
      character_id: string;
      name: string;
      class_id: string;
    }>(
      `WITH consumed AS (
         UPDATE game_tickets
         SET consumed_at = NOW()
         WHERE token_hash = $1
           AND consumed_at IS NULL
           AND expires_at > NOW()
         RETURNING account_id, character_id
       )
       SELECT consumed.account_id, consumed.character_id,
              characters.name, characters.class_id
       FROM consumed
       JOIN characters ON characters.id = consumed.character_id
       WHERE characters.customized = TRUE`,
      [hashToken(token)],
    );
    const row = result.rows[0];
    return row
      ? {
          accountId: row.account_id,
          characterId: row.character_id,
          characterName: row.name,
          classId: row.class_id,
        }
      : null;
  },

  async cleanupExpired(): Promise<void> {
    await database.query("DELETE FROM auth_sessions WHERE expires_at <= NOW()");
    await database.query(
      `DELETE FROM game_tickets
       WHERE expires_at <= NOW() OR consumed_at < NOW() - INTERVAL '1 hour'`,
    );
  },
};
