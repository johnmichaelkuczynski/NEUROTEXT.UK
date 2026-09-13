import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const neurotextWorkspaces = pgTable(
  "neurotext_workspaces",
  {
    sessionId: text("session_id").notNull(),
    functionId: integer("function_id").notNull(),
    payload: jsonb("payload").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.functionId] })],
);

export const neurotextVisitors = pgTable("neurotext_visitors", {
  visitorId: text("visitor_id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const neurotextUsage = pgTable("neurotext_usage", {
  sessionId: text("session_id").primaryKey(),
  operationsUsed: integer("operations_used").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const neurotextDiagnostics = pgTable("neurotext_diagnostics", {
  id: text("id").primaryKey(),
  functionId: integer("function_id").notNull(),
  functionName: text("function_name").notNull(),
  status: text("status").notNull(),
  elapsedMs: integer("elapsed_ms").notNull(),
  firstWordMs: integer("first_word_ms").notNull(),
  wordCount: integer("word_count").notNull(),
  selectedModel: text("selected_model").notNull(),
  provider: text("provider").notNull(),
  cause: text("cause").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});