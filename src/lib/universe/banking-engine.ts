/**
 * Banking Engine — Interest Rates, Accounts, Loans
 *
 * Owns two things: a per-location base interest rate that responds to
 * inflation-engine.ts (a simple Taylor-rule-flavored reaction, not a real
 * central bank model), and character-level bank accounts/loans that accrue
 * interest off that rate. taxation-engine.ts and housing-engine.ts both
 * read a character's account balance when they need to know what someone
 * can actually afford.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import { getCurrentInflation } from './inflation-engine';

const TARGET_INFLATION = 0.03;
const MIN_RATE = 0.005;
const MAX_RATE = 0.20;

export interface BankAccount {
  character_id:      string;
  location_id:        string | null;
  balance:            number;
  savings_rate:       number;
  last_interest_at:   string;
}

export interface Loan {
  id:               string;
  character_id:     string;
  principal:        number;
  balance:          number;
  interest_rate:    number;
  status:           'active' | 'paid_off' | 'defaulted';
}

// ── Public: Rate policy ──────────────────────────────────────────────────────

/**
 * Adjust a location's base rate toward keeping inflation near target — a
 * simplified reaction function, not a literal Taylor rule: rate rises when
 * inflation runs hot, falls when it runs cold, moves in small steps so it
 * never whipsaws in one tick.
 */
export async function runBankingTick(locationId: string): Promise<{ location_id: string; base_rate: number }> {
  const { data: current } = await supabaseAdmin
    .from('central_bank_rates')
    .select('base_rate')
    .eq('location_id', locationId)
    .maybeSingle();

  const baseRate = current?.base_rate ?? 0.04;
  const inflation = await getCurrentInflation(locationId);
  const gap = (inflation?.inflation_rate ?? TARGET_INFLATION) - TARGET_INFLATION;
  const newRate = clamp(baseRate + gap * 0.3, MIN_RATE, MAX_RATE);

  await supabaseAdmin
    .from('central_bank_rates')
    .upsert({ location_id: locationId, base_rate: round4(newRate), updated_at: new Date().toISOString() }, { onConflict: 'location_id' });

  await accrueSavingsInterest(locationId, newRate);
  await accrueLoanInterest();

  return { location_id: locationId, base_rate: round4(newRate) };
}

// ── Public: Accounts ───────────────────────────────────────────────────────────

export async function getOrOpenAccount(characterId: string, locationId?: string): Promise<BankAccount> {
  const { data: existing } = await supabaseAdmin
    .from('bank_accounts')
    .select('*')
    .eq('character_id', characterId)
    .maybeSingle();

  if (existing) return existing as BankAccount;

  const { data: created, error } = await supabaseAdmin
    .from('bank_accounts')
    .insert({ character_id: characterId, location_id: locationId ?? null, balance: 0 })
    .select('*')
    .maybeSingle();

  if (error || !created) {
    logger.warn('banking-engine:open-account-failed', { characterId, error });
    return { character_id: characterId, location_id: locationId ?? null, balance: 0, savings_rate: 0.02, last_interest_at: new Date().toISOString() };
  }
  return created as BankAccount;
}

/**
 * Pure-read variant of getOrOpenAccount() — SELECT only, never INSERTs.
 * For callers on a hot/read-only path (prompt assembly) where lazily
 * creating a persistent bank_accounts row as a side effect of reading a
 * character's prompt context would be surprising and unnecessary: a
 * character with no account yet has no financial signal worth mentioning
 * anyway (equivalent to a freshly-opened account at balance 0), so
 * formatBankingForPrompt() below just treats "no row" the same as
 * "empty account" and returns '' either way — no account gets created.
 */
export async function peekAccount(characterId: string): Promise<BankAccount | null> {
  const { data } = await supabaseAdmin
    .from('bank_accounts')
    .select('*')
    .eq('character_id', characterId)
    .maybeSingle();

  return (data as BankAccount | null) ?? null;
}

export async function deposit(characterId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  await adjustBalance(characterId, amount);
}

export async function withdraw(characterId: string, amount: number): Promise<boolean> {
  if (amount <= 0) return true;
  const account = await getOrOpenAccount(characterId);
  if (account.balance < amount) return false;
  await adjustBalance(characterId, -amount);
  return true;
}

// ── Public: Loans ────────────────────────────────────────────────────────────

export async function originateLoan(
  characterId: string,
  principal:   number,
  interestRate: number,
): Promise<Loan | null> {
  const { data, error } = await supabaseAdmin
    .from('loans')
    .insert({ character_id: characterId, principal, balance: principal, interest_rate: interestRate })
    .select('*')
    .maybeSingle();

  if (error || !data) {
    logger.warn('banking-engine:originate-loan-failed', { characterId, error });
    return null;
  }

  await adjustBalance(characterId, principal);
  return data as Loan;
}

export async function makeLoanPayment(loanId: string, amount: number): Promise<void> {
  const { data: loan } = await supabaseAdmin.from('loans').select('*').eq('id', loanId).maybeSingle();
  if (!loan || loan.status !== 'active') return;

  const newBalance = Math.max(0, loan.balance - amount);
  await supabaseAdmin
    .from('loans')
    .update({
      balance: newBalance,
      status: newBalance <= 0 ? 'paid_off' : 'active',
      last_payment_at: new Date().toISOString(),
    })
    .eq('id', loanId);
}

// ── Public: Prompt Formatter ───────────────────────────────────────────────────

export async function formatBankingForPrompt(characterId: string): Promise<string> {
  const account = await peekAccount(characterId);
  if (!account) return '';

  const { data: activeLoans } = await supabaseAdmin
    .from('loans')
    .select('balance')
    .eq('character_id', characterId)
    .eq('status', 'active');

  const totalDebt = (activeLoans ?? []).reduce((sum, l) => sum + l.balance, 0);
  if (account.balance < 500 && totalDebt === 0) return '';

  const lines: string[] = [];
  if (account.balance < 200) lines.push('Money is tight right now — checking the account balance is a small, real source of stress.');
  if (totalDebt > 0) lines.push('There\'s outstanding debt in the background — not necessarily discussed, but it\'s there.');

  if (lines.length === 0) return '';
  return `[Financial Reality]\n${lines.join('\n')}`;
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function adjustBalance(characterId: string, delta: number): Promise<void> {
  const account = await getOrOpenAccount(characterId);
  const newBalance = round2(account.balance + delta);

  await supabaseAdmin
    .from('bank_accounts')
    .update({ balance: newBalance })
    .eq('character_id', characterId)
    .then(({ error }) => {
      if (error) logger.warn('banking-engine:adjust-balance-failed', { characterId, error });
    });
}

async function accrueSavingsInterest(locationId: string, baseRate: number): Promise<void> {
  const { data: accounts } = await supabaseAdmin
    .from('bank_accounts')
    .select('character_id, balance, savings_rate')
    .eq('location_id', locationId)
    .gt('balance', 0);

  for (const acc of accounts ?? []) {
    // Simple periodic accrual — savings_rate is a spread under the base rate.
    const rate = Math.max(0, baseRate - acc.savings_rate);
    const interest = round2(acc.balance * rate * (1 / 12));
    if (interest > 0) await adjustBalance(acc.character_id, interest);
  }

  await supabaseAdmin
    .from('bank_accounts')
    .update({ last_interest_at: new Date().toISOString() })
    .eq('location_id', locationId);
}

async function accrueLoanInterest(): Promise<void> {
  const { data: loans } = await supabaseAdmin.from('loans').select('*').eq('status', 'active');

  for (const loan of loans ?? []) {
    const interest = round2(loan.balance * loan.interest_rate * (1 / 12));
    const newBalance = loan.balance + interest;

    await supabaseAdmin.from('loans').update({ balance: newBalance }).eq('id', loan.id);

    // Loans that grow well past their principal without payment go into default.
    if (newBalance > loan.principal * 1.6) {
      await supabaseAdmin.from('loans').update({ status: 'defaulted' }).eq('id', loan.id);
    }
  }
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

function round4(val: number): number {
  return Math.round(val * 10000) / 10000;
}
