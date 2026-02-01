import { NextRequest, NextResponse } from 'next/server';
import { pool } from '../../../../lib/db';
import bcrypt from 'bcryptjs';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      firstname,
      lastname,
      username,
      email,
      password,
      sendEmail = true,
    } = body || {};

    if (!firstname || !lastname || !username || !email || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // sprawdź unikalność
    const [dupes] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM panel_users WHERE email = ? OR username = ? LIMIT 1',
      [email, username]
    );
    if (dupes.length) {
      return NextResponse.json({ error: 'Email or username already exists' }, { status: 409 });
    }

    const hash = await bcrypt.hash(password, 10);
    const now = new Date();

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO panel_users 
       (firstname, lastname, username, email, password, role, block, sendEmail, registerDate, lastvisitDate, resetCount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        firstname,
        lastname,
        username,
        email,
        hash,
        0,                   // role: 0 = admin
        0,                   // block
        sendEmail ? 1 : 0,   // sendEmail
        now,                 // registerDate
        null,                // lastvisitDate  ← jeśli kolumna nie pozwala na NULL, patrz sekcja 3
        0,                   // resetCount
      ]
    );

    return NextResponse.json({ ok: true, id: result.insertId }, { status: 201 });
  } catch (err: any) {
    console.error('Sign-up failed:', err); // log do serwera (Plesk -> logs)
    return NextResponse.json(
      { error: 'Sign-up failed', detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
