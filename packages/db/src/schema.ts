import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Campaign, Character, CheckResult } from "@ash/engine";

/** Схема по таблице «Данные» из плана. Состояние героя и кампании — jsonb: его меняет только движок. */

export const tierEnum = pgEnum("tier", ["free", "paid"]);

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());

export const users = pgTable("users", {
  id: id(),
  email: text("email").unique(),
  displayName: text("display_name"),
  tier: tierEnum("tier").notNull().default("free"),
  /** Остаток ходов на текущий период (обнуляется по расписанию). */
  turnsLeft: integer("turns_left").notNull().default(50),
  credits: integer("credits").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const characters = pgTable("characters", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Лист персонажа целиком (раса, класс, характеристики, HP, инвентарь, предыстория). */
  sheet: jsonb("sheet").$type<Character>().notNull(),
  portraitImageId: uuid("portrait_image_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("characters_user_idx").on(t.userId)]);

export const campaigns = pgTable("campaigns", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  characterId: uuid("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  /** Квест, цели, карта, текущая локация, летопись, бой. */
  state: jsonb("state").$type<Campaign>().notNull(),
  /** Номер последнего хода — для оптимистичной блокировки при параллельных запросах. */
  turnNo: integer("turn_no").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("campaigns_user_idx").on(t.userId)]);

export const turns = pgTable("turns", {
  id: id(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  turnNo: integer("turn_no").notNull(),
  kind: text("kind").notNull().default("player"), // player | travel | rest | combat | system
  action: text("action").notNull(),
  narration: text("narration").notNull(),
  speaker: text("speaker"),
  line: text("line"),
  /** Полный разобранный ответ мастера и что из изменений реально применилось. */
  response: jsonb("response").notNull(),
  applied: jsonb("applied"),
  rolls: jsonb("rolls").$type<CheckResult[]>().notNull().default([]),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cachedTokens: integer("cached_tokens").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
  degraded: boolean("degraded").notNull().default(false),
  /** Попал ли ход в летопись (старые ходы сжимаются). */
  chronicled: boolean("chronicled").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index("turns_campaign_idx").on(t.campaignId, t.turnNo)]);

export const npcs = pgTable("npcs", {
  id: id(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  race: text("race").notNull(),
  gender: text("gender").notNull(),
  role: text("role").notNull().default(""),
  appearance: text("appearance").notNull().default(""),
  portraitImageId: uuid("portrait_image_id"),
  /** Отношение к герою: −100 враг … 100 друг. */
  attitude: integer("attitude").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("npcs_campaign_idx").on(t.campaignId)]);

export const images = pgTable("images", {
  id: id(),
  kind: text("kind").notNull(), // portrait | npc | background | map
  prompt: text("prompt").notNull(),
  model: text("model").notNull(),
  url: text("url"),
  status: text("status").notNull().default("queued"), // queued | ready | failed
  /** Теги для повторного использования фонов: тип локации, время суток. */
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
  createdAt: createdAt(),
}, (t) => [index("images_tags_idx").using("gin", t.tags)]);
