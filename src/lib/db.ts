import mysql from 'mysql2/promise';

export const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'PanelBaseUser55',
  password: process.env.DB_PASS || '4?n7YY&Gyepgq6zp',
  database: process.env.DB_NAME || 'panel_base',
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
});
