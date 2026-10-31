import "./env";
import { closeDatabase, initDatabase } from "../src/server/db/client";

await initDatabase();
console.log("Migrations applied.");
await closeDatabase();
