export const runtime = 'nodejs';

import nodemailer from 'nodemailer';

type Body = {
  to?: string;
  subject?: string;
  text: string;
};

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body?.text) {
      return Response.json({ ok: false, error: 'text is required' }, { status: 400 });
    }

    const host = requireEnv('SMTP_HOST');
    const port = Number(process.env.SMTP_PORT || '587');
    const user = requireEnv('SMTP_USER');
    const pass = requireEnv('SMTP_PASS');
    const from = process.env.EMAIL_FROM || user;
    const defaultTo = process.env.ALERT_EMAIL_TO;
    const to = body.to || defaultTo;

    if (!to) {
      return Response.json(
        { ok: false, error: 'No recipient. Provide "to" or set ALERT_EMAIL_TO.' },
        { status: 400 }
      );
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    await transporter.sendMail({
      from,
      to,
      subject: body.subject || '9BOT Alert',
      text: body.text,
    });

    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || 'unknown' }, { status: 500 });
  }
}


