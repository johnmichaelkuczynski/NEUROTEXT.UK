import { pgTable, text, timestamp, integer, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";

export const neurotextUsers = pgTable("neurotext_users", {
  id: text("id").primaryKey(),
  googleSub: text("google_sub").notNull().unique(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const neurotextLibrary = pgTable("neurotext_library", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => neurotextUsers.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  text: text("text").notNull(),
  format: text("format").notNull(),
  wordCount: integer("word_count").notNull(),
  pages: integer("pages").notNull(),
  chargedPages: integer("charged_pages").notNull(),
  chargedBytes: integer("charged_bytes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("neurotext_library_owner").on(table.userId, table.createdAt)]);
export const neurotextHistory = pgTable("neurotext_history", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => neurotextUsers.id, { onDelete: "cascade" }),
  functionId: integer("function_id").notNull(),
  title: text("title").notNull(),
  wordCount: integer("word_count").notNull(),
  contentHash: text("content_hash").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("neurotext_history_version").on(table.userId, table.functionId, table.contentHash),
  index("neurotext_history_owner").on(table.userId, table.createdAt),
]);
