import pg from "pg";
const { Client } = pg;

export class DatabaseClient {
  private connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  async query(sql: string, params: unknown[] = []): Promise<pg.QueryResult> {
    const client = new Client({ connectionString: this.connectionString });
    try {
      await client.connect();
      const result = await client.query(sql, params);
      await client.end();
      return result;
    } catch (error) {
      await client.end().catch(() => {});
      throw error;
    }
  }

  async executeQuery(sqlQuery: string, params: unknown[] = []): Promise<unknown[]> {
    const result = await this.query(sqlQuery, params);
    return result.rows;
  }
}
