import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { pool } from '../../../../lib/db';

// Upewnij się, że tabela to `panel_users` (tak jak pisałeś)
const TABLE = 'panel_users';
const cookiePath = process.env.NEXT_PUBLIC_BASE_PATH && process.env.NEXT_PUBLIC_BASE_PATH !== '/'
  ? process.env.NEXT_PUBLIC_BASE_PATH
  : '/';
  
export async function POST(req: NextRequest) {
  try {
    const { identifier, password } = await req.json();

    if (!identifier || !password) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
    }

    // Szukamy po email LUB username
    const [rows] = await pool.query<any[]>(
      `SELECT id, firstname, lastname, username, email, password, role, block
       FROM ${TABLE}
       WHERE email = ? OR username = ?
       LIMIT 1`,
      [identifier, identifier]
    );

    const user = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    if (user.block && Number(user.block) !== 0) {
      return NextResponse.json({ error: 'Account is blocked' }, { status: 403 });
    }

    const ok = await bcrypt.compare(password, String(user.password || ''));
    if (!ok) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Prosty cookie (jeśli chcesz JWT/sygnowanie – możemy dodać później)
    const res = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        firstname: user.firstname,
        lastname: user.lastname,
      },
    });

    // Cookie na całe /panel (masz basePath '/panel')
    res.cookies.set('panel_uid', String(user.id), {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: cookiePath,
      maxAge: 60 * 60 * 8, // 8h
    });
    res.cookies.set('panel_uname', String(user.username || user.email || ''), {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: cookiePath,
      maxAge: 60 * 60 * 8,
    });

    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Sign-in failed' }, { status: 500 });
  }
}
