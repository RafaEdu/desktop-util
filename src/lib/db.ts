import Database from "@tauri-apps/plugin-sql";

export interface Todo {
  id: number;
  title: string;
  done: number; // 0 or 1 (SQLite boolean)
  created_at: string;
  completed_at: string | null;
  sort_order: number;
}

let dbInstance: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!dbInstance) {
    dbInstance = await Database.load("sqlite:todo.db");
  }
  return dbInstance;
}
