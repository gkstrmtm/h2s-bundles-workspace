import { Pool } from 'pg';
import twilio from 'twilio';

const OWNER_MEDIA_REMINDER_KEY = 'owner-media-upload-reminder';
const OWNER_MEDIA_REMINDER_INTERVAL_DAYS = 14;
const OWNER_MEDIA_REMINDER_TARGET_PHONE = '+18643371068';
const OWNER_MEDIA_REMINDER_MESSAGE = 'Automated Home2Smart reminder: upload any completed jobs here when you get a minute: https://portal.home2smart.com/media . Reply to this number if you need the PIN again.';

type ReminderRow = {
  reminder_key: string;
  recipient_phone: string;
  interval_days: number;
  message_body: string;
  send_count: number;
  last_sent_at: string | null;
  last_twilio_sid: string | null;
  created_at: string;
  updated_at: string;
};

let pool: Pool | null = null;
let tableReady: Promise<void> | null = null;

function safeTrim(value: unknown): string {
  return String(value || '').trim();
}

function getDatabaseUrl(): string {
  const databaseUrl = safeTrim(process.env.DATABASE_URL);
  if (!databaseUrl) throw new Error('Missing DATABASE_URL');
  return databaseUrl;
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getDatabaseUrl(),
      ssl: { rejectUnauthorized: false },
      max: 4,
    });
  }
  return pool;
}

function normalizePhone(raw: string): string {
  const digits = safeTrim(raw).replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits.startsWith('+') ? digits : `+${digits}`;
}

function getTwilioClient() {
  const accountSid = safeTrim(process.env.TWILIO_ACCOUNT_SID);
  const authToken = safeTrim(process.env.TWILIO_AUTH_TOKEN);
  if (!accountSid || !authToken) throw new Error('Twilio client not configured');
  return twilio(accountSid, authToken);
}

function getFromPhone(): string {
  const from = normalizePhone(safeTrim(process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM_NUMBER));
  if (!from) throw new Error('Missing TWILIO_PHONE_NUMBER');
  return from;
}

export async function ensureOwnerMediaReminderTable(): Promise<void> {
  if (tableReady) return tableReady;

  tableReady = (async () => {
    await getPool().query(`
      create table if not exists automation_sms_reminders (
        reminder_key text primary key,
        recipient_phone text not null,
        interval_days integer not null default 14,
        message_body text not null,
        send_count integer not null default 0,
        last_sent_at timestamptz null,
        last_twilio_sid text null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
  })().catch((error) => {
    tableReady = null;
    throw error;
  });

  return tableReady;
}

async function ensureReminderSeeded(): Promise<ReminderRow> {
  await ensureOwnerMediaReminderTable();
  const result = await getPool().query<ReminderRow>(
    `
      insert into automation_sms_reminders (
        reminder_key,
        recipient_phone,
        interval_days,
        message_body
      )
      values ($1, $2, $3, $4)
      on conflict (reminder_key)
      do update set
        recipient_phone = excluded.recipient_phone,
        interval_days = excluded.interval_days,
        message_body = excluded.message_body,
        updated_at = now()
      returning reminder_key, recipient_phone, interval_days, message_body, send_count, last_sent_at, last_twilio_sid, created_at, updated_at
    `,
    [
      OWNER_MEDIA_REMINDER_KEY,
      OWNER_MEDIA_REMINDER_TARGET_PHONE,
      OWNER_MEDIA_REMINDER_INTERVAL_DAYS,
      OWNER_MEDIA_REMINDER_MESSAGE,
    ],
  );
  return result.rows[0];
}

function addDaysIso(value: string | null, days: number): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export async function getOwnerMediaReminderStatus() {
  const row = await ensureReminderSeeded();
  const now = new Date();
  const nextEligibleAt = addDaysIso(row.last_sent_at, row.interval_days || OWNER_MEDIA_REMINDER_INTERVAL_DAYS);
  const due = !nextEligibleAt || new Date(nextEligibleAt).getTime() <= now.getTime();

  return {
    reminderKey: row.reminder_key,
    recipientPhone: row.recipient_phone,
    intervalDays: row.interval_days,
    messageBody: row.message_body,
    sendCount: Number(row.send_count || 0),
    lastSentAt: row.last_sent_at,
    lastTwilioSid: row.last_twilio_sid,
    nextEligibleAt,
    due,
    twilioConfigured: Boolean(safeTrim(process.env.TWILIO_ACCOUNT_SID) && safeTrim(process.env.TWILIO_AUTH_TOKEN) && safeTrim(process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM_NUMBER)),
  };
}

export async function sendOwnerMediaReminder(options?: { force?: boolean }) {
  const force = Boolean(options?.force);
  const status = await getOwnerMediaReminderStatus();

  if (!force && !status.due) {
    return {
      ok: true,
      skipped: true,
      reason: 'not_due',
      status,
    };
  }

  const client = getTwilioClient();
  const from = getFromPhone();
  const message = await client.messages.create({
    from,
    to: status.recipientPhone,
    body: status.messageBody,
  });

  const updated = await getPool().query<ReminderRow>(
    `
      update automation_sms_reminders
      set
        send_count = send_count + 1,
        last_sent_at = now(),
        last_twilio_sid = $2,
        updated_at = now()
      where reminder_key = $1
      returning reminder_key, recipient_phone, interval_days, message_body, send_count, last_sent_at, last_twilio_sid, created_at, updated_at
    `,
    [OWNER_MEDIA_REMINDER_KEY, message.sid],
  );

  return {
    ok: true,
    skipped: false,
    sid: message.sid,
    twilioStatus: (message as any)?.status || null,
    status: {
      ...(await getOwnerMediaReminderStatus()),
      sendCount: Number(updated.rows[0]?.send_count || 0),
      lastSentAt: updated.rows[0]?.last_sent_at || null,
      lastTwilioSid: updated.rows[0]?.last_twilio_sid || null,
    },
  };
}
