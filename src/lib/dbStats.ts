import mysql from 'mysql2/promise';

export const statsPool = mysql.createPool({
  host: process.env.STATS_DB_HOST || 'localhost',
  port: Number(process.env.STATS_DB_PORT || 3306),
  user: process.env.STATS_DB_USER!,
  password: process.env.STATS_DB_PASSWORD!,
  database: process.env.STATS_DB_NAME!,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: 'Z',
});
