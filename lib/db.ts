import Dexie, { type EntityTable } from "dexie";
import type { AnswerMemory, Application } from "./schema";

export class JobTrackerDb extends Dexie {
  applications!: EntityTable<Application, "id">;
  answerMemory!: EntityTable<AnswerMemory, "id">;

  constructor() {
    super("jobAutofillTracker");
    this.version(1).stores({
      applications: "++id, dateApplied, status, company, role, nextActionDate",
      answerMemory: "++id, questionHash, lastUsed"
    });
  }
}

export const db = new JobTrackerDb();
